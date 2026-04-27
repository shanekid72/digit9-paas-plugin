package com.partner.d9;

import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Set;

@Service
public class StatusService {

    private static final Set<String> TERMINAL = Set.of("COMPLETED", "FAILED", "CANCELLED");

    private final D9Client client;

    public StatusService(D9Client client) { this.client = client; }

    public Map<String, Object> confirm(String transactionRefNumber) {
        return client.http().post()
            .uri("/amr/paas/api/v1_0/paas/confirmtransaction")
            .bodyValue(Map.of("transaction_ref_number", transactionRefNumber))
            .retrieve()
            .bodyToMono(Map.class)
            .block();
    }

    public Map<String, Object> enquire(String transactionRefNumber) {
        return client.http().get()
            .uri(b -> b.path("/amr/paas/api/v1_0/paas/enquire-transaction")
                       .queryParam("transaction_ref_number", transactionRefNumber).build())
            .retrieve()
            .bodyToMono(Map.class)
            .block();
    }

    public Map<String, Object> cancel(String transactionRefNumber, String reason, String remarks) {
        return client.http().post()
            .uri("/amr/paas/api/v1_0/paas/canceltransaction")
            .bodyValue(Map.of(
                "transaction_ref_number", transactionRefNumber,
                "cancel_reason",          reason,
                "remarks",                remarks == null ? "" : remarks))
            .retrieve()
            .bodyToMono(Map.class)
            .block();
    }

    /** Polls every 5–30s with backoff until terminal state or timeout. */
    public Map<String, Object> pollUntilTerminal(String transactionRefNumber, Duration maxDuration) {
        var start = Instant.now();
        sleep(5_000);
        while (Duration.between(start, Instant.now()).compareTo(maxDuration) < 0) {
            var r = enquire(transactionRefNumber);
            if (TERMINAL.contains((String) r.get("state"))) return r;
            var elapsed = Duration.between(start, Instant.now()).toMillis();
            sleep(elapsed < 120_000 ? 10_000 : 30_000);
        }
        throw new D9IntegrationException(
            "Transaction " + transactionRefNumber + " did not reach terminal state within " + maxDuration);
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
}
