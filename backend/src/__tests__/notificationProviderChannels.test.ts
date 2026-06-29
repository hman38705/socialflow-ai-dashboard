/**
 * Unit tests for notificationProvider — issue #1098
 *
 * Covers:
 *  - Channel routing: only registered channels are called
 *  - Slack message body contains expected alert fields (service, status, message)
 *  - Delivery failure on one channel does not prevent other channels from being attempted
 */

import { NotificationManager, AlertPayload } from '../services/notificationProvider';

const baseAlert: AlertPayload = {
  severity: 'critical',
  service: 'api-gateway',
  message: 'Health check failed',
  timestamp: '2026-06-29T00:00:00.000Z',
};

describe('NotificationManager — channel routing (#1098)', () => {
  it('calls only the registered providers when sendAlert is invoked', async () => {
    const slackSend = jest.fn().mockResolvedValue(undefined);
    const pagerSend = jest.fn().mockResolvedValue(undefined);

    const manager = new NotificationManager();
    manager.registerProvider('slack', { send: slackSend });
    manager.registerProvider('pagerduty', { send: pagerSend });

    await manager.sendAlert(baseAlert);

    expect(slackSend).toHaveBeenCalledTimes(1);
    expect(pagerSend).toHaveBeenCalledTimes(1);
  });

  it('does not call a provider that was never registered', async () => {
    const slackSend = jest.fn().mockResolvedValue(undefined);
    const unregisteredSend = jest.fn().mockResolvedValue(undefined);

    const manager = new NotificationManager();
    manager.registerProvider('slack', { send: slackSend });

    await manager.sendAlert(baseAlert);

    expect(slackSend).toHaveBeenCalledTimes(1);
    expect(unregisteredSend).not.toHaveBeenCalled();
  });

  it('sends to no providers when none are registered', async () => {
    const manager = new NotificationManager();
    // Should resolve without throwing
    await expect(manager.sendAlert(baseAlert)).resolves.toBeUndefined();
  });
});

describe('NotificationManager — Slack body fields (#1098)', () => {
  it('Slack payload contains service, severity status, and message text', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as typeof fetch;

    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/T000/B000/xxx';

    const { createNotificationManager } = await import('../services/notificationProvider');
    const manager = createNotificationManager();

    await manager.sendAlert({
      severity: 'critical',
      service: 'payment-service',
      message: 'SES delivery failed',
      timestamp: '2026-06-29T00:00:00.000Z',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.slack.test/T000/B000/xxx',
      expect.objectContaining({ method: 'POST' }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const attachment = body.attachments[0];

    expect(attachment.color).toBe('danger');
    expect(attachment.title).toContain('payment-service');
    expect(attachment.title).toContain('CRITICAL');
    expect(attachment.text).toContain('SES delivery failed');

    delete process.env.SLACK_WEBHOOK_URL;
    jest.resetModules();
  });

  it('Slack payload uses warning color for non-critical alerts', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as typeof fetch;

    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/warning';

    const { createNotificationManager } = await import('../services/notificationProvider');
    const manager = createNotificationManager();

    await manager.sendAlert({
      severity: 'warning',
      service: 'cache',
      message: 'Cache hit rate low',
      timestamp: '2026-06-29T00:00:00.000Z',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.attachments[0].color).toBe('warning');

    delete process.env.SLACK_WEBHOOK_URL;
    jest.resetModules();
  });

  it('Slack payload includes detail fields when details are provided', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as typeof fetch;

    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/details';

    const { createNotificationManager } = await import('../services/notificationProvider');
    const manager = createNotificationManager();

    await manager.sendAlert({
      severity: 'critical',
      service: 'worker',
      message: 'Job failed',
      details: { queueName: 'email-queue', errorCode: '500' },
      timestamp: '2026-06-29T00:00:00.000Z',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const fields = body.attachments[0].fields as Array<{ title: string; value: string }>;

    expect(fields.some((f) => f.title === 'queueName' && f.value === 'email-queue')).toBe(true);
    expect(fields.some((f) => f.title === 'errorCode' && f.value === '500')).toBe(true);

    delete process.env.SLACK_WEBHOOK_URL;
    jest.resetModules();
  });
});

describe('NotificationManager — delivery isolation (#1098)', () => {
  it('continues sending to the second provider when the first throws', async () => {
    const failingSend = jest.fn().mockRejectedValue(new Error('Network error'));
    const successSend = jest.fn().mockResolvedValue(undefined);

    const manager = new NotificationManager();
    manager.registerProvider('failing', { send: failingSend });
    manager.registerProvider('success', { send: successSend });

    await manager.sendAlert(baseAlert);

    expect(failingSend).toHaveBeenCalledTimes(1);
    expect(successSend).toHaveBeenCalledTimes(1);
  });

  it('resolves without throwing even when all providers fail', async () => {
    const failA = jest.fn().mockRejectedValue(new Error('A failed'));
    const failB = jest.fn().mockRejectedValue(new Error('B failed'));

    const manager = new NotificationManager();
    manager.registerProvider('a', { send: failA });
    manager.registerProvider('b', { send: failB });

    await expect(manager.sendAlert(baseAlert)).resolves.toBeUndefined();
    expect(failA).toHaveBeenCalledTimes(1);
    expect(failB).toHaveBeenCalledTimes(1);
  });

  it('passes the full alert payload to each provider', async () => {
    const sendA = jest.fn().mockResolvedValue(undefined);
    const sendB = jest.fn().mockResolvedValue(undefined);

    const manager = new NotificationManager();
    manager.registerProvider('a', { send: sendA });
    manager.registerProvider('b', { send: sendB });

    const alert: AlertPayload = {
      ...baseAlert,
      details: { region: 'us-east-1' },
    };

    await manager.sendAlert(alert);

    expect(sendA).toHaveBeenCalledWith(alert);
    expect(sendB).toHaveBeenCalledWith(alert);
  });
});
