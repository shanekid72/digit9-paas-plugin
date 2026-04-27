package com.partner.d9;

import com.partner.d9.MasterDataService.ReceivingMode;
import com.partner.d9.QuoteService.QuoteRequest;
import com.partner.d9.TransactionService.CreateTxnInput;
import com.partner.d9.TransactionService.ServiceType;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * End-to-end sandbox test. Skipped if D9_CLIENT_SECRET / D9_USERNAME aren't set.
 *
 * Mirrors what `/d9:test` does, in code form. Useful in CI as a nightly smoke test.
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "D9_CLIENT_SECRET", matches = ".+")
@EnabledIfEnvironmentVariable(named = "D9_USERNAME",      matches = ".+")
class HappyPathSandboxIT {

    @Autowired MasterDataService masters;
    @Autowired QuoteService      quotes;
    @Autowired TransactionService txns;
    @Autowired StatusService     status;

    @Test
    void onboardCorridorBankQuoteCreateConfirmTerminal() {
        // Master data sanity
        assertThat(masters.listCorridors()).isNotEmpty();
        var banks = masters.listBanks("IN", ReceivingMode.BANK);
        assertThat(banks).isNotEmpty();
        var bank = banks.get(0);
        var accountType = bank.accountTypes().isEmpty() ? "01" : bank.accountTypes().get(0).code();

        // Quote
        var quote = quotes.fetchQuote(new QuoteRequest(
            "AE", "AED", "IN", "INR", new BigDecimal("100"), ReceivingMode.BANK));
        assertThat(quote.quoteId()).isNotBlank();
        assertThat(quote.expiresAt()).isAfter(java.time.Instant.now());

        // Create
        var sender = Map.<String, Object>of(
            "first_name", "Test",
            "last_name",  "Sender",
            "mobile_number", "+971501234567",
            "nationality", "AE",
            "date_of_birth", "1985-04-15",
            "country_of_birth", "GB",
            "sender_id",      List.of(Map.of("id_code", "PASSPORT", "id_number", "GB1234567",
                                              "issue_date", "2019-01-01", "expiry_date", "2029-01-01",
                                              "issued_country", "GB")),
            "sender_address", List.of(Map.of("address_type", "RES", "address_line", "Apt 4B",
                                              "city", "Dubai", "postal_code", "00000", "country_code", "AE")));

        var receiver = Map.<String, Object>of(
            "first_name", "Test",
            "last_name",  "Receiver",
            "mobile_number", "+919812345678",
            "nationality", "IN",
            "relation_code", "FRND",
            "receiver_id",      List.of(Map.of("id_code", "AADHAAR", "id_number", "1234-5678-9012",
                                                "issued_country", "IN")),
            "receiver_address", List.of(Map.of("address_type", "RES", "address_line", "12 MG Road",
                                                "city", "Mumbai", "postal_code", "400001", "country_code", "IN")),
            "bank_details", Map.of(
                "bank_id",           bank.bankId(),
                "iso_code",          bank.isoCode(),
                "account_number",    "12345678901234",
                "account_type_code", accountType));

        var txn = txns.createTransaction(new CreateTxnInput(
            quote, ServiceType.{{SERVICE_TYPE}}, sender, receiver, "SLRY", "SUPP", null));
        assertThat(txn.transactionRefNumber()).matches("\\d{16}");

        // Confirm
        var confirmed = status.confirm(txn.transactionRefNumber());
        assertThat(confirmed.get("state")).isEqualTo("IN_PROGRESS");

        // Poll
        var terminal = status.pollUntilTerminal(txn.transactionRefNumber(), Duration.ofSeconds(90));
        assertThat(terminal.get("state")).isIn("COMPLETED", "FAILED", "CANCELLED");
    }
}
