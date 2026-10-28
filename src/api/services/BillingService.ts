/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Subscription } from '../models/Subscription';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class BillingService {
    /**
     * Provision a Stripe customer and free subscription for the authenticated user
     * @returns Subscription Subscription provisioned
     * @throws ApiError
     */
    public static postBillingProvision(): CancelablePromise<Subscription> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/billing/provision',
            errors: {
                404: `User not found`,
                502: `Stripe error`,
            },
        });
    }
    /**
     * Get the current user's subscription and credit balance
     * @returns Subscription Subscription details
     * @throws ApiError
     */
    public static getBillingSubscription(): CancelablePromise<Subscription> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/billing/subscription',
            errors: {
                404: `No subscription found`,
            },
        });
    }
    /**
     * Get the current user's credit log
     * @returns any Credit log entries
     * @throws ApiError
     */
    public static getBillingCredits(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/billing/credits',
        });
    }
    /**
     * Create a Stripe Checkout session for upgrading to a paid plan
     * @returns any Checkout session URL
     * @throws ApiError
     */
    public static postBillingCheckout({
        requestBody,
    }: {
        requestBody: {
            priceId: string;
            successUrl: string;
            cancelUrl: string;
        },
    }): CancelablePromise<{
        url?: string;
    }> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/billing/checkout',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                502: `Stripe error`,
            },
        });
    }
    /**
     * Create a Stripe Customer Portal session
     * @returns any Portal session URL
     * @throws ApiError
     */
    public static postBillingPortal({
        requestBody,
    }: {
        requestBody: {
            returnUrl: string;
        },
    }): CancelablePromise<{
        url?: string;
    }> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/billing/portal',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                502: `Stripe error`,
            },
        });
    }
    /**
     * Stripe webhook receiver (raw body, HMAC-verified)
     * @returns any Event received
     * @throws ApiError
     */
    public static postBillingWebhook({
        stripeSignature,
        requestBody,
    }: {
        stripeSignature: string,
        requestBody: Blob,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/billing/webhook',
            headers: {
                'stripe-signature': stripeSignature,
            },
            body: requestBody,
            mediaType: 'application/octet-stream',
            errors: {
                400: `Missing signature or invalid payload`,
            },
        });
    }
}
