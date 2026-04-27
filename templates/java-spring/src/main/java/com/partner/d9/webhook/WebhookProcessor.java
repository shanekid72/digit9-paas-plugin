package com.partner.d9.webhook;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Handles a verified, deduped webhook payload. Replace the TODOs with your business logic.
 */
@Component
public class WebhookProcessor {

    private static final Logger log = LoggerFactory.getLogger(WebhookProcessor.class);
    private final ObjectMapper json = new ObjectMapper();

    public void process(String rawBody) throws Exception {
        var node = json.readTree(rawBody);
        var eventType = node.path("event_type").asText();
        switch (eventType) {
            case "transaction.status.changed" -> onTransactionStatusChanged(node);
            case "customer.status.changed"    -> onCustomerStatusChanged(node);
            default -> log.warn("unknown event_type: {}", eventType);
        }
    }

    private void onTransactionStatusChanged(JsonNode payload) {
        // TODO: persist transaction state to your DB; trigger any downstream reconciliation
        log.info("[d9.transaction.status.changed] ref={} state={} sub_state={}",
            payload.path("transaction_ref_number").asText(),
            payload.path("state").asText(),
            payload.path("sub_state").asText());
    }

    private void onCustomerStatusChanged(JsonNode payload) {
        // TODO: update local customer record with new kyc/aml status
        log.info("[d9.customer.status.changed] customer={} kyc={} aml={}",
            payload.path("customer_id").asText(),
            payload.path("kyc_status").asText(),
            payload.path("aml_status").asText());
    }
}
