describe('PredictiveService', () => {
  const loadService = () => {
    jest.resetModules();
    return require('../PredictiveService').predictiveService as any;
  };

  it('returns a reach prediction with content and timing factors', async () => {
    const service = loadService();
    const prediction = await service.predictReach({
      content: 'A strong post with a call to action to click the link and comment',
      platform: 'instagram',
      hashtags: ['travel', 'food', 'fashion'],
      mediaType: 'image',
      followerCount: 10000,
      scheduledTime: new Date('2024-06-20T20:00:00.000Z'),
    });

    expect(prediction.reachScore).toBeGreaterThan(50);
    expect(prediction.estimatedReach.expected).toBeGreaterThan(0);
    expect(prediction.factors.some((factor: { name: string }) => factor.name === 'Content Length')).toBe(true);
    expect(prediction.recommendations.some((recommendation: string) => recommendation.includes('call-to-action'))).toBe(true);
  });

  it('uses seeded medians to adjust historical reach expectations', async () => {
    const service = loadService();
    service.seedFromMedians({ instagram: { avgReach: 250000, avgEngagement: 12.5 } });

    const prediction = await service.predictReach({
      content: 'Short post',
      platform: 'instagram',
      scheduledTime: new Date('2024-06-22T10:00:00.000Z'),
    });

    expect(prediction.estimatedReach.expected).toBeGreaterThan(0);
    expect(prediction.confidence).toBeGreaterThan(0.5);
  });

  it('updates historical performance and caps hashtag tracking', () => {
    const service = loadService();
    service.updateHistoricalData('instagram', 5000, 7, 'video', ['travel', 'travel', 'food', 'fashion']);

    const historical = service['historicalData'].get('instagram');
    expect(historical.avgReach).toBeGreaterThan(0);
    expect(historical.avgEngagement).toBeGreaterThan(0);
    expect(historical.topHashtags).toContain('travel');
    expect(historical.topHashtags).toContain('food');
  });
});
