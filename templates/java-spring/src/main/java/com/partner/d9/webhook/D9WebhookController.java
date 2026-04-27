package com.partner.d9.webhook;

import com.partner.d9.config.D9Config;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Receives Digit9 webhooks. Verifies HMAC-SHA256 over the RAW body, checks the
 * timestamp window (±5 minutes), dedupes by Idempotency-Key, then dispatches.
 *
 * Returning 200 on signature failure is a security bug — always 401 on bad sig.
 */
@RestController
@RequestMapping("/webhooks")
public class D9WebhookController {

    private static final Logger log = LoggerFactory.getLogger(D9WebhookController.class);
    private static final long MAX_SKEW_MS = 5 * 60_000L;

    private final D9Config cfg;
    private final WebhookProcessor processor;

    // In-memory dedupe — REPLACE with Redis or a DB table for production.
    private final ConcurrentHashMap<String, Instant> seen = new ConcurrentHashMap<>();

    public D9WebhookController(D9Config cfg, WebhookProcessor processor) {
        this.cfg       = cfg;
        this.processor = processor;
    }

    @PostMapping(value = "/digit9", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> receive(
        @RequestHeader("X-Signature")     String signature,
        @RequestHeader("X-Timestamp")     String timestamp,
        @RequestHeader("Idempotency-Key") String idemKey,
        @RequestBody  byte[] rawBody
    ) throws Exception {

        if (cfg.webhookSecret() == null || cfg.webhookSecret().isBlank()) {
            log.error("D9_WEBHOOK_SECRET not configured");
            return ResponseEntity.status(500).body("webhook receiver misconfigured");
        }

        // 1. timestamp window
        try {
            var ts = Instant.parse(timestamp);
            if (Math.abs(Duration.between(ts, Instant.now()).toMillis()) > MAX_SKEW_MS) {
                return ResponseEntity.status(401).body("timestamp out of range");
            }
        } catch (Exception e) {
            return ResponseEntity.status(401).body("invalid timestamp");
        }

        // 2. HMAC verify
        var mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(cfg.webhookSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        var expected = mac.doFinal(rawBody);
        byte[] actual;
        try {
            actual = HexFormat.of().parseHex(signature);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(401).body("invalid signature format");
        }
        if (!MessageDigest.isEqual(expected, actual)) {
            return ResponseEntity.status(401).body("signature mismatch");
        }

        // 3. idempotency
        if (seen.putIfAbsent(idemKey, Instant.now()) != null) {
            return ResponseEntity.ok("duplicate, ignored");
        }

        // 4. process
        try {
            processor.process(new String(rawBody, StandardCharsets.UTF_8));
            return ResponseEntity.ok("ok");
        } catch (Exception e) {
            seen.remove(idemKey); // allow retry
            log.error("webhook processing failed", e);
            return ResponseEntity.status(500).body("processing failed");
        }
    }
}
