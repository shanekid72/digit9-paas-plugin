package com.partner.d9.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Typed access to all D9_* environment variables. Every other class consumes
 * configuration via this record rather than reading env vars directly.
 */
@ConfigurationProperties(prefix = "d9")
public record D9Config(
    String baseUrl,
    String webComponentBaseUrl,
    String clientId,
    String clientSecret,
    String username,
    String password,
    String sender,
    String channel,
    String company,
    String branch,
    String webhookSecret
) {}
