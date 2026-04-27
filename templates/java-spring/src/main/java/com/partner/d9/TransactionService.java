package com.partner.d9;

import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Service
public class TransactionService {

    public enum ServiceType { C2C, B2B }

    public record CreateTxnInput(
        QuoteService.Quote quote,
        ServiceType serviceType,
        Map<String, Object> sender,
        Map<String, Object> receiver,
        String sourceOfIncome,
        String purposeOfTxn,
        String agentRefOverride
    ) {}

    public record Transaction(
        String transactionRefNumber,
        String agentTransactionRefNumber,
        Instant expiresAt,
        Object raw
    ) {}

    private static final String PARTNER_PREFIX = "{{PARTNER_PREFIX}}";

    private final D9Client client;

    public TransactionService(D9Client client) { this.client = client; }

    @SuppressWarnings("unchecked")
    public Transaction createTransaction(CreateTxnInput input) {
        if (QuoteService.isExpired(input.quote())) {
            throw new D9IntegrationException(
                "Quote expired before createTransaction. Re-quote and ask the user to confirm.");
        }

        var agentRef = input.agentRefOverride() != null && !input.agentRefOverride().isBlank()
            ? input.agentRefOverride()
            : PARTNER_PREFIX + "_" + UUID.randomUUID();

        var body = Map.of(
            "quote_id",                     input.quote().quoteId(),
            "service_type",                 input.serviceType().name(),
            "agent_transaction_ref_number", agentRef,
            "sender",                       input.sender(),
            "receiver",                     input.receiver(),
            "transaction", Map.of(
                "source_of_income", input.sourceOfIncome(),
                "purpose_of_txn",   input.purposeOfTxn()));

        var resp = client.http().post()
            .uri("/amr/paas/api/v1_0/paas/createtransaction")
            .bodyValue(body)
            .retrieve()
            .bodyToMono(Map.class)
            .block();

        if (!"ACCEPTED".equals(resp.get("state"))) {
            throw new D9IntegrationException(
                "Unexpected state on createTransaction: " + resp.get("state") + "/" + resp.get("sub_state"));
        }

        var data = (Map<String, Object>) resp.get("data");
        return new Transaction(
            (String) data.get("transaction_ref_number"),
            (String) data.get("agent_transaction_ref_number"),
            Instant.parse((String) data.get("expires_at")),
            resp);
    }
}
