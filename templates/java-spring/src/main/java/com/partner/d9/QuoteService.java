package com.partner.d9;

import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;

@Service
public class QuoteService {

    public record QuoteRequest(
        String sendingCountry,
        String sendingCurrency,
        String receivingCountry,
        String receivingCurrency,
        BigDecimal sendingAmount,
        MasterDataService.ReceivingMode receivingMode
    ) {}

    public record Quote(
        String quoteId,
        Instant expiresAt,
        BigDecimal rate,
        BigDecimal ourFeesTotal,
        Object raw
    ) {}

    private static final long SAFETY_SECONDS = 5L;

    private final D9Client client;

    public QuoteService(D9Client client) { this.client = client; }

    @SuppressWarnings("unchecked")
    public Quote fetchQuote(QuoteRequest req) {
        var body = Map.of(
            "sending_country_code",    req.sendingCountry(),
            "sending_currency_code",   req.sendingCurrency(),
            "receiving_country_code",  req.receivingCountry(),
            "receiving_currency_code", req.receivingCurrency(),
            "sending_amount",          req.sendingAmount(),
            "receiving_mode",          req.receivingMode().name(),
            "type",                    "SEND",
            "instrument",              "REMITTANCE");

        var resp = client.http().post()
            .uri("/amr/paas/api/v1_0/paas/quote")
            .bodyValue(body)
            .retrieve()
            .bodyToMono(Map.class)
            .block();

        var data    = (Map<String, Object>) resp.get("data");
        if (!"QUOTE_CREATED".equals(data.get("sub_state"))) {
            throw new D9IntegrationException("Unexpected sub_state: " + data.get("sub_state"));
        }

        // fx_rates is an array — typically two entries, both SELL: one for
        // sending→receiving and the inverse. Pick the sending→receiving direction.
        var fxRates = (List<Map<String, Object>>) data.getOrDefault("fx_rates", List.of());
        var primary = fxRates.stream()
            .filter(r -> "SELL".equals(r.get("type"))
                      && req.sendingCurrency().equals(r.get("base_currency_code"))
                      && req.receivingCurrency().equals(r.get("counter_currency_code")))
            .findFirst()
            .orElseThrow(() -> new D9IntegrationException(
                "No SELL rate found for " + req.sendingCurrency() + "→"
                    + req.receivingCurrency() + " in quote response"));

        var fees = (List<Map<String, Object>>) data.getOrDefault("fee_details", List.of());

        var ourFees = fees.stream()
            .filter(f -> "OUR".equals(f.get("model")))
            .map(f -> new BigDecimal(String.valueOf(f.get("amount"))))
            .reduce(BigDecimal.ZERO, BigDecimal::add);

        return new Quote(
            (String) data.get("quote_id"),
            Instant.parse((String) data.get("expires_at")),
            new BigDecimal(String.valueOf(primary.get("rate"))),
            ourFees,
            resp);
    }

    public static boolean isExpired(Quote q) {
        return Instant.now().plusSeconds(SAFETY_SECONDS).isAfter(q.expiresAt());
    }
}
