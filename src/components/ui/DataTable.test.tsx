import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DataTable, type Column, type SortState } from './DataTable';

interface Row {
  id: string;
  name: string;
  count: number;
}

const rows: Row[] = [
  { id: 'a', name: 'Alpha', count: 3 },
  { id: 'b', name: 'Bravo', count: 1 },
];

const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'count', header: 'Count', numeric: true, sortable: true },
];

describe('DataTable', () => {
  test('sortable header cycles asc -> desc -> none and updates aria-sort', () => {
    const changes: Array<SortState | null> = [];
    const { rerender } = render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        sort={null}
        onSortChange={(s) => changes.push(s)}
      />,
    );
    const nameHeader = screen.getByRole('columnheader', { name: /name/i });
    const button = within(nameHeader).getByRole('button');

    expect(nameHeader).toHaveAttribute('aria-sort', 'none');

    act(() => button.click());
    expect(changes[0]).toEqual({ key: 'name', direction: 'asc' });
    rerender(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        sort={{ key: 'name', direction: 'asc' }}
        onSortChange={(s) => changes.push(s)}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /name/i })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );

    act(() =>
      within(screen.getByRole('columnheader', { name: /name/i }))
        .getByRole('button')
        .click(),
    );
    expect(changes[1]).toEqual({ key: 'name', direction: 'desc' });

    rerender(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        sort={{ key: 'name', direction: 'desc' }}
        onSortChange={(s) => changes.push(s)}
      />,
    );
    act(() =>
      within(screen.getByRole('columnheader', { name: /name/i }))
        .getByRole('button')
        .click(),
    );
    expect(changes[2]).toBeNull();
  });

  test('select-all checkbox reflects indeterminate when only some rows are selected', () => {
    const { rerender } = render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        selectable
        selectedIds={['a']}
        onSelectionChange={() => {}}
      />,
    );
    const headerCheckbox = screen.getByLabelText('Select all rows') as HTMLInputElement;
    expect(headerCheckbox.indeterminate).toBe(true);
    expect(headerCheckbox.checked).toBe(false);

    rerender(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        selectable
        selectedIds={['a', 'b']}
        onSelectionChange={() => {}}
      />,
    );
    const all = screen.getByLabelText('Select all rows') as HTMLInputElement;
    expect(all.indeterminate).toBe(false);
    expect(all.checked).toBe(true);
  });

  test('loading renders skeleton rows matching the column count', () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        getRowId={(r: Row) => r.id}
        selectable
        loading
        loadingRows={3}
      />,
    );
    const skeletonRows = screen.getAllByTestId('skeleton-row');
    expect(skeletonRows).toHaveLength(3);
    // 2 columns + 1 selection column
    expect(within(skeletonRows[0]).getAllByRole('cell')).toHaveLength(3);
  });

  test('empty (no rows, not loading) renders the provided empty state', () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        getRowId={(r: Row) => r.id}
        emptyState={<p>Nothing here</p>}
      />,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });
});
