package com.test;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import java.util.Map;

public class Handler implements RequestHandler<Map<String, Object>, Map<String, Object>> {
    @Override
    public Map<String, Object> handleRequest(Map<String, Object> input, Context context) {
        if (input.containsKey("fail")) {
            throw new RuntimeException("Intentional test failure: " + input.get("fail"));
        }
        return Map.of("statusCode", 200, "body", "OK", "input", input);
    }
}
