import React from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bell,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Filter,
  Image as ImageIcon,
  Info,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Trash2,
  Upload,
  User,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

// === Types

/**
 * Curated icon set. Add a name here (and its lucide component to `ICONS`) rather than
 * importing lucide components ad hoc across the app, so the icon vocabulary stays small
 * and every import is tree-shakeable.
 */
export type IconName =
  | 'alert'
  | 'arrow-left'
  | 'arrow-right'
  | 'bell'
  | 'calendar'
  | 'check'
  | 'check-circle'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-up'
  | 'clock'
  | 'copy'
  | 'download'
  | 'external-link'
  | 'eye'
  | 'eye-off'
  | 'filter'
  | 'image'
  | 'info'
  | 'logout'
  | 'more'
  | 'edit'
  | 'plus'
  | 'refresh'
  | 'search'
  | 'send'
  | 'settings'
  | 'trash'
  | 'upload'
  | 'user'
  | 'x'
  | 'x-circle';

export type IconSize = 'sm' | 'md' | 'lg';

interface IconBaseProps {
  name: IconName;
  size?: IconSize;
  className?: string;
}

/**
 * Decorative icons omit `label` and are hidden from assistive tech. An icon that carries
 * meaning on its own must pass `label`, which exposes it as `role="img"`.
 */
type IconProps = (IconBaseProps & { label: string }) | (IconBaseProps & { label?: undefined });

// === Constants

const ICONS: Record<IconName, LucideIcon> = {
  alert: AlertTriangle,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  bell: Bell,
  calendar: Calendar,
  check: Check,
  'check-circle': CheckCircle2,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  clock: Clock,
  copy: Copy,
  download: Download,
  'external-link': ExternalLink,
  eye: Eye,
  'eye-off': EyeOff,
  filter: Filter,
  image: ImageIcon,
  info: Info,
  logout: LogOut,
  more: MoreHorizontal,
  edit: Pencil,
  plus: Plus,
  refresh: RefreshCw,
  search: Search,
  send: Send,
  settings: Settings,
  trash: Trash2,
  upload: Upload,
  user: User,
  x: X,
  'x-circle': XCircle,
};

const SIZE_PX: Record<IconSize, number> = { sm: 16, md: 20, lg: 24 };

// === Component

export const Icon: React.FC<IconProps> = ({ name, size = 'md', className = '', label }) => {
  const Glyph = ICONS[name];
  const px = SIZE_PX[size];

  if (label) {
    return (
      <Glyph
        width={px}
        height={px}
        className={className || undefined}
        role="img"
        aria-label={label}
      />
    );
  }
  return <Glyph width={px} height={px} className={className || undefined} aria-hidden="true" />;
};

export default Icon;
