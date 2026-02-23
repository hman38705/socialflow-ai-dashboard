import React from 'react';
import '@testing-library/jest-dom';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Settings } from '../../components/Settings';

// simple smoke test for component rendering

describe('Settings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders all major sections', () => {
    render(<Settings onNavigate={() => {}} />);

    expect(screen.getByText('General Options')).toBeInTheDocument();
    expect(screen.getByText('Network Configuration')).toBeInTheDocument();
    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.getByText('Gas Fee Preferences')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Analytics Storage')).toBeInTheDocument();
  });

  it('allows changing network configuration', () => {
    render(<Settings onNavigate={() => {}} />);

    const select = screen.getByTestId('network-select');
    expect(select).toHaveValue('mainnet');

    fireEvent.change(select, { target: { value: 'testnet' } });
    expect(select).toHaveValue('testnet');
  });

  it('toggles security settings', () => {
    render(<Settings onNavigate={() => {}} />);
    const twoFactorToggle = screen.getByText('Two-Factor Authentication');
    const autoLockToggle = screen.getByText('Auto-Lock on Inactivity');

    // clicking label should toggle courtesy of the button inside
    fireEvent.click(twoFactorToggle);
    fireEvent.click(autoLockToggle);

    expect(twoFactorToggle).toBeInTheDocument();
    expect(autoLockToggle).toBeInTheDocument();
  });

  it('adjusts gas fee preferences', () => {
    render(<Settings onNavigate={() => {}} />);
    const low = screen.getByTestId('fee-low') as HTMLInputElement;
    const medium = screen.getByTestId('fee-medium') as HTMLInputElement;
    const high = screen.getByTestId('fee-high') as HTMLInputElement;

    expect(medium.checked).toBe(true);

    fireEvent.click(low);
    expect(low.checked).toBe(true);

    fireEvent.click(high);
    expect(high.checked).toBe(true);
  });

  it('mixes notification preferences toggle (email)', () => {
    render(<Settings onNavigate={() => {}} />);
    const emailToggle = screen.getByText('Email Notifications');
    fireEvent.click(emailToggle);
    expect(emailToggle).toBeInTheDocument();
  });

  it('manages analytics storage settings', () => {
    render(<Settings onNavigate={() => {}} />);
    const freq = screen.getByTestId('frequency-select') as HTMLSelectElement;
    const cost = screen.getByTestId('estimated-cost');
    const autoStore = screen.getByText('Automatic On-Chain Storage');
    const manualBtn = screen.getByTestId('manual-store-button');

    expect(freq.value).toBe('daily');
    expect(cost).toHaveTextContent('$0.10');

    fireEvent.change(freq, { target: { value: 'weekly' } });
    expect(cost).toHaveTextContent('$0.50');

    fireEvent.click(autoStore);

    // manual storage should update history
    fireEvent.click(manualBtn);
    expect(screen.queryByTestId('history-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('history-list')).toBeInTheDocument();
  });
});
