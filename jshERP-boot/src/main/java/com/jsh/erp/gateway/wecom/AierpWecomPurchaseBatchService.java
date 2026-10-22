package com.jsh.erp.gateway.wecom;

import com.alibaba.fastjson.JSONObject;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.Map;

/**
 * AIERP-017B2: thin WeCom entry for multi-purchase verified DRAFT batch.
 * Delegates to {@link AierpWecomExcelService#prepareVerifiedBatch} so preview/idempotency
 * and audited replay stay in one place. Never posts inventory / never calls excel.confirm.
 */
@Service
public class AierpWecomPurchaseBatchService {

    @Resource
    private AierpWecomExcelService excelService;

    public Map<String, Object> prepare(JSONObject body) throws Exception {
        return excelService.prepareVerifiedBatch(body);
    }
}
