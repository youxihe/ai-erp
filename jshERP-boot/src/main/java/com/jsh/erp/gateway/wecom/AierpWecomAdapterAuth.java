package com.jsh.erp.gateway.wecom;

import com.jsh.erp.exception.BusinessRunTimeException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * HMAC auth for OpenClaw ↔ ERP adapter calls. Not an ERP user session.
 */
@Component
public class AierpWecomAdapterAuth {

    private static final long MAX_SKEW_MS = 120_000L;

    @Value("${aierp.wecom.adapter-secret:}")
    private String adapterSecret;

    public void verify(HttpServletRequest request, String rawBody) {
        if (adapterSecret == null || adapterSecret.trim().isEmpty()) {
            throw new BusinessRunTimeException(503, "适配器密钥未配置（aierp.wecom.adapter-secret）");
        }
        String ts = request.getHeader("X-Aierp-Adapter-Timestamp");
        String sig = request.getHeader("X-Aierp-Adapter-Signature");
        if (ts == null || sig == null || ts.trim().isEmpty() || sig.trim().isEmpty()) {
            throw new BusinessRunTimeException(401, "缺少适配器签名头");
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
        String method = request.getMethod() == null ? "POST" : request.getMethod().toUpperCase();
        String path = request.getRequestURI();
        String payload = method + "\n" + path + "\n" + ts.trim() + "\n" + (rawBody == null ? "" : rawBody);
        String expect = hmacHex(adapterSecret.trim(), payload);
        if (!constantTimeEquals(expect, sig.trim().toLowerCase())) {
            throw new BusinessRunTimeException(401, "适配器签名校验失败");
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
