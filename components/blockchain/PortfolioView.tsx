import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, Legend 
} from 'recharts';
import { 
  RefreshCw, Plus, Trash2, Filter, ChevronDown,
  Wallet, TrendingUp, Search as SearchIcon
} from 'lucide-react';
import { Card } from '../ui/Card';
import stellarService, { Asset } from '../../services/stellarService';
import walletService from '../../services/walletService';
import priceService from '../../services/priceService';
import { AddTrustlineModal } from './AddTrustlineModal';
import { 
  AssetFilter, 
  AssetSort, 
  SortDirection, 
  BlockchainAsset 
} from '../../types';


const CHART_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

// Skeleton component for loading state
const AssetSkeleton: React.FC = () => (
  <div className="flex items-center gap-4 p-4 animate-pulse">
    <div className="w-10 h-10 rounded-full bg-gray-700"></div>
    <div className="flex-1 space-y-2">
      <div className="h-4 w-24 bg-gray-700 rounded"></div>
      <div className="h-3 w-16 bg-gray-700 rounded"></div>
    </div>
    <div className="text-right space-y-2">
      <div className="h-4 w-20 bg-gray-700 rounded"></div>
      <div className="h-3 w-12 bg-gray-700 rounded"></div>
    </div>
  </div>
);

// Empty state component
const EmptyState: React.FC<{ onAddTrustline: () => void }> = ({ onAddTrustline }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <Wallet className="w-16 h-16 text-gray-500 mb-4" />
    <h3 className="text-xl font-semibold text-gray-300 mb-2">No Assets Found</h3>
    <p className="text-gray-500 mb-6 max-w-md">
      Your connected wallet doesn't have any assets yet. Add a trustline to start tracking tokens.
    </p>
    <button
      onClick={onAddTrustline}
      className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
    >
      <Plus className="w-5 h-5" />
      Add Trustline
    </button>
  </div>
);

export const PortfolioView: React.FC = () => {
  const [assets, setAssets] = useState<BlockchainAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [showAddModal, setShowAddModal] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // Filter and sort state
  const [filter, setFilter] = useState<AssetFilter>('all');
  const [sortBy, setSortBy] = useState<AssetSort>('value');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [chartView, setChartView] = useState<'pie' | 'bar'>('pie');

  // Confirmation dialog state
  const [confirmRemove, setConfirmRemove] = useState<{ code: string; issuer: string } | null>(null);

  // Load filter/sort preferences from localStorage
  useEffect(() => {
    const savedFilter = localStorage.getItem('portfolio-filter') as AssetFilter;
    const savedSort = localStorage.getItem('portfolio-sort') as AssetSort;
    const savedDirection = localStorage.getItem('portfolio-direction') as SortDirection;
    const savedCurrency = localStorage.getItem('portfolio-currency') as string;
    
    if (savedFilter) setFilter(savedFilter);
    if (savedSort) setSortBy(savedSort);
    if (savedDirection) setSortDirection(savedDirection);
    if (savedCurrency) setCurrency(savedCurrency);
  }, []);

  // Save preferences to localStorage
  const savePreferences = useCallback((newFilter: AssetFilter, newSort: AssetSort, newDirection: SortDirection, newCurrency: string) => {
    localStorage.setItem('portfolio-filter', newFilter);
    localStorage.setItem('portfolio-sort', newSort);
    localStorage.setItem('portfolio-direction', newDirection);
    localStorage.setItem('portfolio-currency', newCurrency);
  }, []);

  // Fetch portfolio data
  const fetchPortfolio = useCallback(async () => {
    try {
      const key = walletService.getConnectedWallet();
      if (!key) {
        // Try to connect
        try {
          const connectedKey = await walletService.connectFreighter();
          setPublicKey(connectedKey);
        } catch {
          setError('Please connect your wallet to view portfolio');
          setLoading(false);
          return;
        }
      }

      const walletKey = key || publicKey;
      if (!walletKey) {
        setError('No wallet connected');
        setLoading(false);
        return;
      }

      setPublicKey(walletKey);
      const balances = await stellarService.getAccountBalances(walletKey);
      
      // Get prices and calculate values
      const assetsWithValues: BlockchainAsset[] = await Promise.all(
        balances.map(async (asset: Asset) => {
          const price = await priceService.getPrice(asset.code, currency);
          const value = parseFloat(asset.balance) * price;
          return {
            ...asset,
            price,
            value
          };
        })
      );

      setAssets(assetsWithValues);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch portfolio:', err);
      setError('Failed to load portfolio data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currency, publicKey]);

  // Initial load
  useEffect(() => {
    fetchPortfolio();
  }, [fetchPortfolio]);

  // Handle refresh
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchPortfolio();
  }, [fetchPortfolio]);

  // Filter and sort assets
  const filteredAssets = useMemo(() => {
    let result = [...assets];

    // Apply search filter
    if (searchQuery) {
      result = result.filter(asset => 
        asset.code.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply category filter
    switch (filter) {
      case 'tokens':
        result = result.filter(asset => asset.code !== 'XLM');
        break;
      case 'nfts':
        // For now, treat non-fungible tokens differently
        result = result.filter(asset => parseFloat(asset.balance) === 0);
        break;
      case 'zero_balance':
        result = result.filter(asset => parseFloat(asset.balance) === 0);
        break;
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'name':
          comparison = a.code.localeCompare(b.code);
          break;
        case 'balance':
          comparison = parseFloat(a.balance) - parseFloat(b.balance);
          break;
        case 'value':
          comparison = (a.value || 0) - (b.value || 0);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [assets, filter, sortBy, sortDirection, searchQuery]);

  // Calculate total portfolio value
  const totalValue = useMemo(() => {
    return filteredAssets.reduce((sum, asset) => sum + (asset.value || 0), 0);
  }, [filteredAssets]);

  // Chart data
  const chartData = useMemo(() => {
    return filteredAssets
      .filter(asset => (asset.value || 0) > 0)
      .map((asset, index) => ({
        name: asset.code,
        value: asset.value || 0,
        balance: parseFloat(asset.balance),
        color: CHART_COLORS[index % CHART_COLORS.length]
      }));
  }, [filteredAssets]);

  // Handle filter change
  const handleFilterChange = useCallback((newFilter: AssetFilter) => {
    setFilter(newFilter);
    savePreferences(newFilter, sortBy, sortDirection, currency);
  }, [savePreferences, sortBy, sortDirection, currency]);

  // Handle sort change
  const handleSortChange = useCallback((newSort: AssetSort) => {
    if (newSort === sortBy) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(newSort);
    }
    savePreferences(filter, newSort, sortDirection, currency);
  }, [savePreferences, filter, sortBy, sortDirection, currency]);

  // Handle currency change
  const handleCurrencyChange = useCallback((newCurrency: string) => {
    setCurrency(newCurrency);
    savePreferences(filter, sortBy, sortDirection, newCurrency);
  }, [savePreferences, filter, sortBy, sortDirection]);

  // Handle trustline creation success
  const handleTrustlineCreated = useCallback(() => {
    setShowAddModal(false);
    setNotification({ type: 'success', message: 'Trustline created successfully!' });
    handleRefresh();
    setTimeout(() => setNotification(null), 3000);
  }, [handleRefresh]);

  // Handle trustline creation error
  const handleTrustlineError = useCallback((error: string) => {
    setNotification({ type: 'error', message: error });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  // Handle remove trustline
  const handleRemoveTrustline = useCallback(async (code: string, issuer: string) => {
    if (!publicKey) return;
    
    try {
      setLoading(true);
      const xdr = await stellarService.removeTrustline(publicKey, code, issuer);
      const signedXDR = await walletService.signTransaction(xdr);
      await stellarService.submitTransaction(signedXDR);
      
      setNotification({ type: 'success', message: `Trustline for ${code} removed successfully!` });
      setConfirmRemove(null);
      handleRefresh();
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to remove trustline' });
    } finally {
      setLoading(false);
      setTimeout(() => setNotification(null), 3000);
    }
  }, [publicKey, handleRefresh]);

  // Render asset icon
  const renderAssetIcon = (code: string) => {
    if (code === 'XLM') {
      return (
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
          <span className="text-white font-bold text-sm">XLM</span>
        </div>
      );
    }
    return (
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-teal-600 flex items-center justify-center">
        <span className="text-white font-bold text-xs">{code.slice(0, 3)}</span>
      </div>
    );
  };

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  // Currency options
  const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'];

  return (
    <div className="space-y-6">
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg ${
          notification.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        }`}>
          {notification.message}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Portfolio</h1>
          <p className="text-gray-400">Track your Stellar assets</p>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Currency Selector */}
          <select
            value={currency}
            onChange={(e) => handleCurrencyChange(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {currencies.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          {/* Add Trustline Button */}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Trustline
          </button>
        </div>
      </div>

      {/* Total Value Card */}
      <Card className="bg-gradient-to-r from-blue-900/50 to-purple-900/50">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-gray-400 text-sm">Total Portfolio Value</p>
            <h2 className="text-4xl font-bold text-white mt-1">
              {loading ? (
                <span className="animate-pulse">---</span>
              ) : (
                formatCurrency(totalValue)
              )}
            </h2>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2 text-green-400">
              <TrendingUp className="w-5 h-5" />
              <span className="text-sm">Live</span>
            </div>
            <p className="text-gray-400 text-xs mt-1">
              {assets.length} asset{assets.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </Card>

      {/* Charts */}
      {!loading && chartData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Chart Toggle */}
          <div className="lg:col-span-2 flex justify-end mb-2">
            <div className="flex bg-gray-800 rounded-lg p-1">
              <button
                onClick={() => setChartView('pie')}
                className={`px-4 py-2 rounded-md text-sm transition-colors ${
                  chartView === 'pie' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                Allocation
              </button>
              <button
                onClick={() => setChartView('bar')}
                className={`px-4 py-2 rounded-md text-sm transition-colors ${
                  chartView === 'bar' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                Balances
              </button>
            </div>
          </div>

          {/* Pie Chart */}
          {chartView === 'pie' && (
            <Card>
              <h3 className="text-lg font-semibold text-white mb-4">Asset Allocation</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Bar Chart */}
          {chartView === 'bar' && (
            <Card>
              <h3 className="text-lg font-semibold text-white mb-4">Asset Balances</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="name" stroke="#9CA3AF" />
                  <YAxis stroke="#9CA3AF" />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      name === 'value' ? formatCurrency(value) : value,
                      name === 'value' ? 'Value' : 'Balance'
                    ]}
                    contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                  />
                  <Bar dataKey="balance" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}
        </div>
      )}

      {/* Filters and Search */}
      <Card>
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          {/* Search */}
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search assets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-gray-400" />
            <select
              value={filter}
              onChange={(e) => handleFilterChange(e.target.value as AssetFilter)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Assets</option>
              <option value="tokens">Tokens</option>
              <option value="nfts">NFTs</option>
              <option value="zero_balance">Zero Balance</option>
            </select>
          </div>

          {/* Sort */}
          <div className="flex items-center gap-2">
            <ChevronDown className="w-5 h-5 text-gray-400" />
            <select
              value={sortBy}
              onChange={(e) => handleSortChange(e.target.value as AssetSort)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="value">Sort by Value</option>
              <option value="name">Sort by Name</option>
              <option value="balance">Sort by Balance</option>
            </select>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="text-center py-8">
            <p className="text-red-400 mb-4">{error}</p>
            <button
              onClick={handleRefresh}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <AssetSkeleton key={i} />
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && assets.length === 0 && (
          <EmptyState onAddTrustline={() => setShowAddModal(true)} />
        )}

        {/* Asset List */}
        {!loading && !error && filteredAssets.length > 0 && (
          <div className="space-y-2">
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-4 px-4 py-2 text-sm text-gray-400 font-medium">
              <div className="col-span-4">Asset</div>
              <div className="col-span-3 text-right">Balance</div>
              <div className="col-span-3 text-right">Value</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {/* Asset Rows */}
            {filteredAssets.map((asset, _index) => (
              <div
                key={`${asset.code}-${asset.issuer}`}
                className="grid grid-cols-12 gap-4 px-4 py-3 bg-gray-800/50 hover:bg-gray-800 rounded-lg items-center transition-colors"
              >
                {/* Asset Info */}
                <div className="col-span-4 flex items-center gap-3">
                  {renderAssetIcon(asset.code)}
                  <div>
                    <p className="text-white font-medium">{asset.code}</p>
                    {asset.issuer && (
                      <p className="text-gray-500 text-xs">
                        {asset.issuer.slice(0, 8)}...{asset.issuer.slice(-4)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Balance */}
                <div className="col-span-3 text-right">
                  <p className="text-white">{parseFloat(asset.balance).toLocaleString()}</p>
                  <p className="text-gray-500 text-xs">{asset.code}</p>
                </div>

                {/* Value */}
                <div className="col-span-3 text-right">
                  <p className="text-white font-medium">
                    {formatCurrency(asset.value || 0)}
                  </p>
                  {asset.price && (
                    <p className="text-gray-500 text-xs">
                      {formatCurrency(asset.price)}/{asset.code}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="col-span-2 text-right">
                  {asset.code !== 'XLM' && (
                    <button
                      onClick={() => setConfirmRemove({ code: asset.code, issuer: asset.issuer })}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                      title="Remove Trustline"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Filter Results Count */}
        {!loading && !error && assets.length > 0 && filteredAssets.length !== assets.length && (
          <p className="text-gray-500 text-sm mt-4 text-center">
            Showing {filteredAssets.length} of {assets.length} assets
          </p>
        )}
      </Card>

      {/* Add Trustline Modal */}
      <AddTrustlineModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={handleTrustlineCreated}
        onError={handleTrustlineError}
      />

      {/* Confirmation Dialog */}
      {confirmRemove && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-xl max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold text-white mb-4">Confirm Removal</h3>
            <p className="text-gray-300 mb-6">
              Are you sure you want to remove the trustline for <strong>{confirmRemove.code}</strong>? 
              This will stop tracking this asset in your portfolio.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmRemove(null)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRemoveTrustline(confirmRemove.code, confirmRemove.issuer)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-white transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PortfolioView;
