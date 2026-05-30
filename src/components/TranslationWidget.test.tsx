import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TranslationWidget } from './TranslationWidget';
import { translationService } from '../services/TranslationService';

jest.mock('../services/TranslationService', () => ({
  translationService: {
    getSupportedLanguages: jest.fn(() => [
      { code: 'es', name: 'Spanish', nativeName: 'Espanol', flag: 'ES' },
      { code: 'fr', name: 'French', nativeName: 'Francais', flag: 'FR' },
    ]),
    searchLanguages: jest.fn(() => []),
    translate: jest.fn(),
  },
}));

const translateMock = translationService.translate as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  translateMock.mockResolvedValue({
    provider: 'mock',
    sourceLanguage: 'en',
    translations: [],
    preservedElements: [],
  });
});

afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

test('debounces translation API calls', async () => {
  render(<TranslationWidget text="Hello" debounceMs={500} />);

  fireEvent.click(screen.getByText('Spanish'));
  const button = screen.getByRole('button', { name: /translate to 1 language/i });

  fireEvent.click(button);
  fireEvent.click(button);

  expect(translateMock).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(500);
  });

  expect(translateMock).toHaveBeenCalledTimes(1);
  expect(translateMock).toHaveBeenCalledWith(expect.objectContaining({
    text: 'Hello',
    targetLanguages: ['es'],
  }));
});

test('cancels pending debounce on unmount', async () => {
  const { unmount } = render(<TranslationWidget text="Hello" debounceMs={500} />);

  fireEvent.click(screen.getByText('Spanish'));
  fireEvent.click(screen.getByRole('button', { name: /translate to 1 language/i }));
  unmount();

  act(() => {
    jest.advanceTimersByTime(500);
  });

  expect(translateMock).not.toHaveBeenCalled();
});
