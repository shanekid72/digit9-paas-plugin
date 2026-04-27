package com.partner.d9;

import com.partner.d9.config.D9Config;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;

/**
 * The single place that talks HTTP to Digit9.
 *
 * Encapsulates:
 *   - OAuth2 password-grant token acquisition against Keycloak
 *   - Token caching with a 30-second safety margin before expiry
 *   - The four mandatory context headers (sender, channel, company, branch)
 *
 * Inject and call {@link #http()} for the configured WebClient. Don't construct your own.
 */
@Component
public class D9Client {

    private static final long SAFETY_SECONDS = 30L;

    private final D9Config cfg;
    private final WebClient http;
    private final AtomicReference<TokenCache> token = new AtomicReference<>();

    public D9Client(D9Config cfg, WebClient.Builder builder) {
        this.cfg = cfg;
        this.http = builder
            .baseUrl(cfg.baseUrl())
            .filter((req, next) -> getToken().flatMap(t ->
                next.exchange(ClientRequest.from(req)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + t)
                    .header("sender",  cfg.sender())
                    .header("channel", cfg.channel())
                    .header("company", cfg.company())
                    .header("branch",  cfg.branch())
                    .build())))
            .build();
    }

    public WebClient http() {
        return http;
    }

    public Mono<String> currentAccessToken() {
        return getToken();
    }

    private Mono<String> getToken() {
        var cur = token.get();
        if (cur != null && Instant.now().plusSeconds(SAFETY_SECONDS).isBefore(cur.expiresAt())) {
            return Mono.just(cur.accessToken());
        }
        return WebClient.create(cfg.baseUrl())
            .post()
            .uri("/auth/realms/cdp/protocol/openid-connect/token")
            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .body(BodyInserters.fromFormData("grant_type", "password")
                .with("client_id",     cfg.clientId())
                .with("client_secret", cfg.clientSecret())
                .with("username",      cfg.username())
                .with("password",      cfg.password())
                .with("scope",         "openid"))
            .retrieve()
            .bodyToMono(TokenResponse.class)
            .map(r -> {
                var c = new TokenCache(
                    r.access_token(),
                    r.refresh_token(),
                    Instant.now().plusSeconds(r.expires_in())
                );
                token.set(c);
                return c.accessToken();
            });
    }

    record TokenResponse(String access_token, String refresh_token, long expires_in, long refresh_expires_in, String token_type) {}
    record TokenCache(String accessToken, String refreshToken, Instant expiresAt) {}
}
