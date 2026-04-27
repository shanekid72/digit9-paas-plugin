package com.partner.d9;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.List;
import java.util.Map;

@Service
public class MasterDataService {

    public enum ReceivingMode { BANK, CASHPICKUP, WALLET }

    public record AccountType(String code, String name) {}
    public record Bank(String bankId, String bankName, String isoCode, List<AccountType> accountTypes) {}
    public record Branch(String branchId, String branchCode, String branchName, String city) {}
    public record Corridor(String sendingCountry, String receivingCountry, String receivingCurrency, List<String> receivingModes) {}

    private final D9Client client;
    private final Cache<String, List<Bank>>     bankCache;
    private final Cache<String, List<Branch>>   branchCache;
    private final Cache<String, List<Corridor>> corridorCache;

    public MasterDataService(D9Client client) {
        this.client       = client;
        this.bankCache    = Caffeine.newBuilder().expireAfterWrite(Duration.ofHours(24)).build();
        this.branchCache  = Caffeine.newBuilder().expireAfterWrite(Duration.ofHours(24)).build();
        this.corridorCache = Caffeine.newBuilder().expireAfterWrite(Duration.ofHours(24)).build();
    }

    @SuppressWarnings("unchecked")
    public List<Corridor> listCorridors() {
        return corridorCache.get("all", k -> {
            var resp = client.http().get().uri("/raas/masters/v1/service-corridor")
                .retrieve().bodyToMono(Map.class).block();
            var data = (List<Map<String, Object>>) resp.get("data");
            return data.stream().map(d -> new Corridor(
                (String) d.get("sending_country_code"),
                (String) d.get("receiving_country_code"),
                (String) d.get("receiving_currency_code"),
                (List<String>) d.getOrDefault("receiving_modes", List.of())
            )).toList();
        });
    }

    @SuppressWarnings("unchecked")
    public List<Bank> listBanks(String receivingCountryCode, ReceivingMode mode) {
        var key = receivingCountryCode + ":" + mode;
        return bankCache.get(key, k -> {
            var resp = client.http().get()
                .uri(b -> b.path("/raas/masters/v1/banks")
                           .queryParam("receiving_country_code", receivingCountryCode)
                           .queryParam("receiving_mode",         mode.name())
                           .build())
                .retrieve().bodyToMono(Map.class).block();
            var data = (List<Map<String, Object>>) resp.get("data");
            return data.stream().map(d -> new Bank(
                (String) d.get("bank_id"),
                (String) d.get("bank_name"),
                (String) d.get("iso_code"),
                ((List<Map<String, Object>>) d.getOrDefault("account_types", List.of()))
                    .stream().map(a -> new AccountType(
                        (String) a.get("account_type_code"),
                        (String) a.get("account_type_name")))
                    .toList()
            )).toList();
        });
    }

    @SuppressWarnings("unchecked")
    public List<Branch> listBranches(String bankId) {
        return branchCache.get(bankId, k -> {
            var resp = client.http().get()
                .uri("/raas/masters/v1/banks/{id}/branches", bankId)
                .retrieve().bodyToMono(Map.class).block();
            var data = (List<Map<String, Object>>) resp.get("data");
            return data.stream().map(d -> new Branch(
                (String) d.get("branch_id"),
                (String) d.get("branch_code"),
                (String) d.get("branch_name"),
                (String) d.get("city")
            )).toList();
        });
    }
}
