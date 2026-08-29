import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Pagination, pageTokens } from './Pagination';

describe('pageTokens', () => {
  test('no ellipsis for small page counts', () => {
    expect(pageTokens(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  test('page 1 of many: trailing ellipsis only', () => {
    expect(pageTokens(1, 20)).toEqual([1, 2, 'ellipsis', 20]);
  });

  test('middle page: leading and trailing ellipsis', () => {
    expect(pageTokens(10, 20)).toEqual([1, 'ellipsis', 9, 10, 11, 'ellipsis', 20]);
  });

  test('last page: leading ellipsis only', () => {
    expect(pageTokens(20, 20)).toEqual([1, 'ellipsis', 19, 20]);
  });
});

describe('Pagination', () => {
  test('renders nothing for a single page', () => {
    const { container } = render(
      <Pagination page={1} pageSize={10} total={8} onPageChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('marks the current page with aria-current', () => {
    render(<Pagination page={2} pageSize={10} total={50} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
  });

  test('changing page size resets to page 1', () => {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    render(
      <Pagination
        page={4}
        pageSize={10}
        total={500}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />,
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    select.value = '25';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onPageSizeChange).toHaveBeenCalledWith(25);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});
