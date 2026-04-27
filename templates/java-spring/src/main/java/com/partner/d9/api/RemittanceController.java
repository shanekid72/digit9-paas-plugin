package com.partner.d9.api;

import com.partner.d9.MasterDataService.ReceivingMode;
import com.partner.d9.QuoteService;
import com.partner.d9.QuoteService.QuoteRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;

/** Sample partner-facing endpoint that wraps the D9 quote flow. Replace with real business logic. */
@RestController
@RequestMapping("/api/remittances")
public class RemittanceController {

    private final QuoteService quotes;

    public RemittanceController(QuoteService quotes) { this.quotes = quotes; }

    @PostMapping("/quote")
    public ResponseEntity<?> quote(@RequestBody QuoteApiRequest req) {
        var q = quotes.fetchQuote(new QuoteRequest(
            req.sendingCountry  != null ? req.sendingCountry  : "AE",
            req.sendingCurrency != null ? req.sendingCurrency : "AED",
            req.receivingCountry  != null ? req.receivingCountry  : "IN",
            req.receivingCurrency != null ? req.receivingCurrency : "INR",
            req.amount != null ? req.amount : new BigDecimal("100"),
            req.mode   != null ? req.mode   : ReceivingMode.BANK
        ));
        return ResponseEntity.ok(java.util.Map.of(
            "quote_id",   q.quoteId(),
            "rate",       q.rate(),
            "our_fees",   q.ourFeesTotal(),
            "expires_at", q.expiresAt().toString()));
    }

    public static class QuoteApiRequest {
        public String sendingCountry;
        public String sendingCurrency;
        public String receivingCountry;
        public String receivingCurrency;
        public BigDecimal amount;
        public ReceivingMode mode;
    }
}
