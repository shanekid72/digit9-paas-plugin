package com.partner.d9;

import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Map;

@Service
public class TransactionService {

    public record CreateTxnInput(
        QuoteService.Quote quote,
        Map<String, Object> sender,
        Map<String, Object> receiver,
        String sourceOfIncome,
        String purposeOfTxn,
        String message
    ) {}

    public record Transaction(
        String transactionRefNumber,
        Instant expiresAt,
        Object raw
    ) {}

    private final D9Client client;

    public TransactionService(D9Client client) { this.client = client; }

    /**
     * Create a transaction from a quote.
     *
     * Idempotency is keyed off sender.agent_customer_number plus quote_id. Calling
     * with the same agent_customer_number against the same quote_id returns the
     * existing transaction — safe to retry on network timeout with the same body.
     *
     * Body shape per the canonical PAASTestAgent Postman collection: type,
     * instrument, source_of_income, purpose_of_txn, message live at top level;
     * `transaction` only carries `quote_id`. There is no top-level `service_type`
     * or `agent_transaction_ref_number` in the canonical happy-path body.
     */
    @SuppressWarnings("unchecked")
    public Transaction createTransaction(CreateTxnInput input) {
        if (QuoteService.isExpired(input.quote())) {
            throw new D9IntegrationException(
                "Quote expired before createTransaction. Re-quote and ask the user to confirm.");
        }

        var body = Map.of(
            "type",             "SEND",
            "instrument",       "REMITTANCE",
            "source_of_income", input.sourceOfIncome(),
            "purpose_of_txn",   input.purposeOfTxn(),
            "message",          input.message() != null && !input.message().isBlank()
                                    ? input.message() : "Agency transaction",
            "sender",           input.sender(),
            "receiver",         input.receiver(),
            "transaction",      Map.of("quote_id", input.quote().quoteId()));

        var resp = client.http().post()
            .uri("/amr/paas/api/v1_0/paas/createtransaction")
            .bodyValue(body)
            .retrieve()
            .bodyToMono(Map.class)
            .block();

        var data = (Map<String, Object>) resp.get("data");
        if (data == null || !"ACCEPTED".equals(data.get("state"))) {
            throw new D9IntegrationException(
                "Unexpected state on createTransaction: "
                    + (data != null ? data.get("state") : null) + "/"
                    + (data != null ? data.get("sub_state") : null));
        }

        return new Transaction(
            (String) data.get("transaction_ref_number"),
            Instant.parse((String) data.get("expires_at")),
            resp);
    }
}
