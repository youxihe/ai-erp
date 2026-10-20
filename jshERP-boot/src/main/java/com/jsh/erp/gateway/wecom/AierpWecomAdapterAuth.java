package com.jsh.erp.gateway.wecom;

import com.jsh.erp.exception.BusinessRunTimeException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.annotation.PostConstruct;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;

/**
 * HMAC auth for OpenClaw ↔ ERP adapter calls. Fail-closed: no usable default secret.
 */
@Component
public class AierpWecomAdapterAuth {

    private static final long MAX_SKEW_MS = 120_000L;
    private static final long NONCE_TTL_MS = 180_000L;
    private static final int MIN_SECRET_LEN = 32;
    private static final List<String> BANNED_EXACT = Arrays.asList(
            "aierp-local-wecom-adapter-change-me",
            "change-me",
            "changeme",
            "secret",
            "password",
            "default",
            "your-secret-here",
            "ai erp wecom adapter secret"
    );

    @Value("${aierp.wecom.adapter-secret:}")
    private String adapterSecret;

    private final ConcurrentHashMap<String, Long> seenNonces = new ConcurrentHashMap<String, Long>();

    @PostConstruct
    public void requireStrongSecretAtStartup() {
        // Fail closed at boot so a missing env cannot silently authorize callers.
        try {
            requireConfiguredSecret();
        } catch (BusinessRunTimeException ex) {
            throw new IllegalStateException(ex.getMessage(), ex);
        }
    }

    public void verify(HttpServletRequest request, String rawBody) {
        String secret = requireConfiguredSecret();
        String ts = request.getHeader("X-Aierp-Adapter-Timestamp");
        String sig = request.getHeader("X-Aierp-Adapter-Signature");
        String nonce = request.getHeader("X-Aierp-Adapter-Nonce");
        if (ts == null || sig == null || nonce == null
                || ts.trim().isEmpty() || sig.trim().isEmpty() || nonce.trim().isEmpty()) {
            throw new BusinessRunTimeException(401, "缺少适配器签名头（timestamp/signature/nonce）");
        }
        nonce = nonce.trim();
        if (nonce.length() < 16 || nonce.length() > 128) {
            throw new BusinessRunTimeException(401, "适配器 nonce 无效");
        }
        long epochMs;
        try {
            epochMs = Long.parseLong(ts.trim());
        } catch (NumberFormatException ex) {
            throw new BusinessRunTimeException(401, "适配器时间戳无效");
        }
        long now = System.currentTimeMillis();
        if (Math.abs(now - epochMs) > MAX_SKEW_MS) {
            throw new BusinessRunTimeException(401, "适配器签名已过期");
        }
        pruneNonces(now);
        Long prev = seenNonces.putIfAbsent(nonce, now);
        if (prev != null) {
            throw new BusinessRunTimeException(401, "适配器 nonce 已使用（拒绝重放）");
        }
        String method = request.getMethod() == null ? "POST" : request.getMethod().toUpperCase(Locale.ROOT);
        String path = request.getRequestURI();
        String payload = method + "\n" + path + "\n" + ts.trim() + "\n" + nonce + "\n" + (rawBody == null ? "" : rawBody);
        String expect = hmacHex(secret, payload);
        if (!constantTimeEquals(expect, sig.trim().toLowerCase(Locale.ROOT))) {
            throw new BusinessRunTimeException(401, "适配器签名校验失败");
        }
    }

    private String requireConfiguredSecret() {
        String secret = adapterSecret == null ? "" : adapterSecret.trim();
        if (secret.isEmpty()) {
            throw new BusinessRunTimeException(503, "适配器密钥未配置：请设置环境变量 AIERP_WECOM_ADAPTER_SECRET（高熵随机值）");
        }
        if (secret.length() < MIN_SECRET_LEN) {
            throw new BusinessRunTimeException(503, "适配器密钥过短：至少 " + MIN_SECRET_LEN + " 字符");
        }
        String lower = secret.toLowerCase(Locale.ROOT);
        for (String banned : BANNED_EXACT) {
            if (lower.equals(banned) || lower.contains("change-me") || lower.contains("changeme")
                    || lower.contains("example") || lower.contains("placeholder")) {
                throw new BusinessRunTimeException(503, "适配器密钥为禁止的示例/占位值，请轮换为高熵随机密钥");
            }
        }
        return secret;
    }

    private void pruneNonces(long now) {
        if (seenNonces.size() < 64) {
            return;
        }
        for (ConcurrentHashMap.Entry<String, Long> e : seenNonces.entrySet()) {
            if (now - e.getValue() > NONCE_TTL_MS) {
                seenNonces.remove(e.getKey(), e.getValue());
            }
        }
    }

    private static String hmacHex(String secret, String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] raw = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(raw.length * 2);
            for (byte b : raw) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception ex) {
            throw new BusinessRunTimeException(500, "适配器签名计算失败");
        }
    }

    private static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null) {
            return false;
        }
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }
}
