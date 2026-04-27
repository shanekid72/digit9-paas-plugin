package com.partner.d9;

/** Thrown when Digit9 returns an unexpected state or shape. */
public class D9IntegrationException extends RuntimeException {
    public D9IntegrationException(String message) { super(message); }
    public D9IntegrationException(String message, Throwable cause) { super(message, cause); }
}
