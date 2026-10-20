package com.jsh.erp.gateway.assistant;

import com.alibaba.fastjson.JSONObject;
import com.jsh.erp.utils.BaseResponseInfo;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;

@RestController
@RequestMapping("/aierp/v1/assistant")
public class AierpAssistantController {

    @Resource
    private AierpAssistantService assistantService;

    @PostMapping("/turn")
    public BaseResponseInfo turn(@RequestBody JSONObject body, HttpServletRequest request) throws Exception {
        BaseResponseInfo res = new BaseResponseInfo();
        res.code = 200;
        res.data = assistantService.turn(body, request);
        return res;
    }
}
