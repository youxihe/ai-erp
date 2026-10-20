package com.jsh.erp.gateway.excel;

import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.utils.BaseResponseInfo;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

@RestController
@RequestMapping("/aierp/v1/excel")
public class AierpExcelController {

    @Resource
    private AierpExcelService excelService;

    @GetMapping("/template")
    public ResponseEntity<byte[]> template(@RequestParam("scene") String scene, HttpServletRequest request) throws Exception {
        return xlsx(excelService.template(scene, null, request), scene);
    }

    @PostMapping("/template")
    public ResponseEntity<byte[]> templateFilled(@RequestBody JSONObject body, HttpServletRequest request) throws Exception {
        String scene = body.getString("scene");
        return xlsx(excelService.template(scene, body, request), scene);
    }

    @PostMapping(value = "/preview", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public BaseResponseInfo preview(@RequestParam("file") MultipartFile file,
                                    @RequestParam(value = "scene", required = false) String scene,
                                    HttpServletRequest request) throws Exception {
        return ok(excelService.preview(file, scene, request));
    }

    @PostMapping("/confirm")
    public BaseResponseInfo confirm(@RequestBody JSONObject body, HttpServletRequest request) throws Exception {
        return ok(excelService.confirm(body, request));
    }

    @GetMapping("/receipt")
    public ResponseEntity<byte[]> receipt(@RequestParam("batchId") String batchId, HttpServletRequest request) throws Exception {
        return xlsx(excelService.receipt(batchId, request), "receipt-" + batchId);
    }

    private ResponseEntity<byte[]> xlsx(byte[] body, String name) throws Exception {
        String encoded = URLEncoder.encode(name + ".xlsx", StandardCharsets.UTF_8.name()).replace("+", "%20");
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + encoded)
                .contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .body(body);
    }

    private BaseResponseInfo ok(Object data) {
        BaseResponseInfo res = new BaseResponseInfo();
        res.code = 200;
        res.data = data;
        return res;
    }
}
