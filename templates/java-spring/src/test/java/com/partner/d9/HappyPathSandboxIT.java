package com.partner.d9;

import com.partner.d9.MasterDataService.ReceivingMode;
import com.partner.d9.QuoteService.QuoteRequest;
import com.partner.d9.TransactionService.CreateTxnInput;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * End-to-end sandbox test. Skipped if D9_CLIENT_SECRET / D9_USERNAME aren't set.
 *
 * Runs the canonical happy path: auth → masters → quote → create → confirm.
 * Polling to terminal state is intentionally NOT included — sandbox payout
 * dwell ("not a partner bug" per /digit9-paas:d9-test) makes that flaky for
 * CI. Use the /digit9-paas:d9-test slash command for the full polling demo.
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
    void onboardCorridorBankQuoteCreateConfirm() {
        // Master data sanity. The list results aren't fed into createTransaction —
        // IN bank_details below uses canonical Postman values for repeatable test
        // results regardless of which bank ranks first in the list response.
        assertThat(masters.listCorridors()).isNotEmpty();
        assertThat(masters.listBanks("IN", ReceivingMode.BANK)).isNotEmpty();

        // Quote
        var quote = quotes.fetchQuote(new QuoteRequest(
            "AE", "AED", "IN", "INR", new BigDecimal("100"), ReceivingMode.BANK));
        assertThat(quote.quoteId()).isNotBlank();
        assertThat(quote.expiresAt()).isAfter(java.time.Instant.now());

        // Create — canonical AE → IN BANK shape per the d9-transaction skill
        // (taken verbatim from the PAASTestAgent Postman collection).
        var sender = Map.<String, Object>of(
            "agent_customer_number", "DEMO_TEST_001",
            "mobile_number",         "+971508359468",
            "first_name",            "George",
            "last_name",             "Micheal",
            "date_of_birth",         "1995-08-22",
            "country_of_birth",      "IN",
            "nationality",           "IN",
            "sender_id", List.of(Map.of(
                "id_code",       "4",                    // numeric — Emirates ID
                "id",            "784199191427626",
                "issued_on",     "2022-10-31",
                "valid_through", "2030-11-01")),         // must be today or later
            "sender_address", List.of(Map.of(
                "address_type", "PRESENT",               // PRESENT | PERMANENT — not RES/BIZ
                "address_line", "Sheikh Zayed Road, Tower 3",
                "post_code",    "710",                   // post_code, not postal_code
                "town_name",    "DUBAI",                 // town_name, not city
                "country_code", "AE")));

        var receiver = Map.<String, Object>of(
            "first_name",    "Anija FirstName",
            "last_name",     "Anija Lastname",
            "mobile_number", "+919586741500",
            "date_of_birth", "1990-08-22",
            "gender",        "F",
            "nationality",   "IN",
            "relation_code", "32",                       // numeric — friend
            "receiver_address", List.of(Map.of(
                "address_type", "PRESENT",
                "address_line", "12 MG Road",
                "town_name",    "THRISSUR",
                "country_code", "IN")),
            "bank_details", Map.of(
                "account_type_code", "1",                // numeric-as-string — savings
                "routing_code",      "FDRL0001033",      // IFSC for IN; no iso_code, no bank_id
                "account_number",    "99345724439934"));

        var txn = txns.createTransaction(new CreateTxnInput(
            quote, sender, receiver, "SLRY", "SUPP", null));
        assertThat(txn.transactionRefNumber()).matches("\\d{16}");

        // Confirm
        var confirmed = status.confirm(txn.transactionRefNumber());
        assertThat(confirmed.get("state")).isIn("IN_PROGRESS", "COMPLETED");
    }
}
