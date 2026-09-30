import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, keepPreviousData, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, ArrowRight, Bell, Boxes, Check, CheckCircle2,
  ChevronDown, ChevronLeft, ChevronRight, CircleHelp, CircleDot, ClipboardList,
  Eye, EyeOff, LogOut, MapPin, Menu, MessageCircle, MoveRight, Package,
  Pencil, Plus, Route as RouteIcon, Search, Send, ShieldCheck, Snowflake, Sprout, Thermometer,
  Trash2, Truck, Warehouse, X,
} from 'lucide-react';
import {
  OrderStatus as OrderStatusEnum,
  getAcknowledgeAlertMutationKey,
  getCreateOrderMutationKey,
  getCreateShipmentMutationKey,
  getDeleteOrderMutationKey,
  getGetCurrentUserQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetOrderQueryKey,
  getHealthCheckQueryKey,
  getListAlertsQueryKey,
  getListOrdersQueryKey,
  getListShipmentsQueryKey,
  getUpdateOrderMutationKey,
  getUpdateOrderStatusMutationKey,
  useAcknowledgeAlert,
  useCreateOrder,
  useCreateShipment,
  useDeleteOrder,
  useGetCurrentUser,
  useGetDashboardSummary,
  useGetOrder,
  useHealthCheck,
  useListAlerts,
  useListOrders,
  useListShipments,
  useLogin,
  useLogout,
  useSignup,
  useUpdateOrder,
  useUpdateOrderStatus,
  type Alert,
  type ListOrdersParams,
  type Order,
  type OrderInput,
  type OrderStatus,
  type Shipment,
  type ShipmentInput,
  type User,
} from '@workspace/api-client-react';
import { Link, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import './index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });
const ORDER_STATUSES = Object.values(OrderStatusEnum) as OrderStatus[];
const ROLE_NAMES: Record<User['role'], string> = {
  FARMER: 'Farmer',
  TRANSPORTER: 'Transporter',
  WAREHOUSE_ADMIN: 'Warehouse admin',
  RETAILER: 'Retailer',
};
const ROLE_ROUTES: Record<User['role'], string> = {
  FARMER: '/farmer',
  TRANSPORTER: '/transporter',
  WAREHOUSE_ADMIN: '/warehouse',
  RETAILER: '/retailer',
};

function cx(...parts: Array<string | undefined | false>) { return parts.filter(Boolean).join(' '); }
function errMsg(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
function money(value: number) { return new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(value); }
function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Date unavailable' : new Intl.DateTimeFormat('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase(); }

function Brand() {
  return <Link href="/" className="brand" data-testid="link-brand"><span className="brand-mark"><Snowflake size={19} /></span><span>AgriSupply</span></Link>;
}

function ApiBadge() {
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), staleTime: 60_000, retry: 0 } });
  const good = ['ok', 'healthy'].includes(health.data?.status?.toLowerCase() ?? '');
  return <span className={cx('pill', good ? 'pill-ok' : 'pill-neutral')} data-testid="status-api-health">
    <CircleDot size={8} fill="currentColor" />{health.isLoading ? 'Connecting' : health.isError ? 'Service status unavailable' : `Service ${health.data?.status ?? 'available'}`}
  </span>;
}

function Loading({ rows = 5 }: { rows?: number }) {
  return <div className="glass loading-block" role="status" aria-label="Loading" data-testid="state-loading">{Array.from({ length: rows }, (_, i) => <div className="skeleton" key={i} style={{ width: `${94 - i * 7}%` }} />)}</div>;
}
function ErrorBox({ error, retry }: { error: unknown; retry: () => void }) {
  return <div className="glass state-card" role="alert" data-testid="state-error"><AlertTriangle size={24} color="var(--danger)" /><h3>We couldn’t load this view</h3><p>{errMsg(error)}</p><button className="btn" onClick={retry} data-testid="button-retry">Try again</button></div>;
}
function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="glass state-card" data-testid="state-empty"><CircleDot size={25} color="var(--ice)" /><h3>{title}</h3><p>{body}</p>{action && <div style={{ marginTop: 15 }}>{action}</div>}</div>;
}
function Pill({ value }: { value: string }) {
  const tone = ['Delivered', 'Confirmed', 'At Warehouse'].includes(value) ? 'pill-ok' : ['In Transit', 'Picked Up'].includes(value) ? 'pill-info' : value === 'Rejected' ? 'pill-bad' : 'pill-warn';
  return <span className={`pill ${tone}`} data-testid={`status-${value.toLowerCase().replaceAll(' ', '-')}`}>{value}</span>;
}

function AuthRedirect() {
  const [, go] = useLocation();
  const current = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  useEffect(() => {
    if (current.data) go(ROLE_ROUTES[current.data.role]);
    else if (current.isError) go('/login');
  }, [current.data, current.isError, go]);
  return <div className="app-shell grain" style={{ padding: 24 }}><Loading rows={3} /></div>;
}

function Guard({ children }: { children: (user: User) => ReactNode }) {
  const [, go] = useLocation();
  const current = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  useEffect(() => { if (current.isError) go('/login'); }, [current.isError, go]);
  if (current.isLoading || (!current.data && !current.isError)) return <div className="app-shell grain" style={{ padding: 24 }}><Loading /></div>;
  return current.data ? <>{children(current.data)}</> : null;
}

type PageKey = 'dashboard' | 'orders' | 'shipments' | 'alerts';

function Workspace({ user, page, children }: { user: User; page: PageKey; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [, go] = useLocation();
  const qc = useQueryClient();
  const logout = useLogout({ mutation: { mutationKey: ['logout'], onSuccess: () => { qc.removeQueries({ queryKey: getGetCurrentUserQueryKey() }); go('/login'); } } });
  const nav = [
    { href: ROLE_ROUTES[user.role], title: 'Overview', key: 'dashboard' as const, icon: Activity },
    { href: '/orders', title: 'Orders', key: 'orders' as const, icon: ClipboardList },
    { href: '/shipments', title: 'Shipments', key: 'shipments' as const, icon: Truck },
    { href: '/alerts', title: 'Alerts', key: 'alerts' as const, icon: Bell },
  ];
  return <div className="workspace app-shell grain" data-testid="workspace">
    <button aria-label="Close navigation" className={cx('drawer-scrim', menuOpen && 'open')} onClick={() => setMenuOpen(false)} data-testid="button-close-navigation" />
    <aside className={cx('sidebar', menuOpen && 'open')} data-testid="navigation-sidebar">
      <Brand />
      <div className="org-switch" data-testid="text-organization"><strong>{user.organizationName}</strong><small>{ROLE_NAMES[user.role]} workspace</small></div>
      <div className="nav-group"><div className="nav-caption">Workspace</div>{nav.map(({ href, title, key, icon: Icon }) =>
        <Link key={key} href={href} onClick={() => setMenuOpen(false)} className={cx('side-link', page === key && 'active')} data-testid={`link-nav-${key}`}><Icon size={17} /><span>{title}</span></Link>)}</div>
      <div className="sidebar-bottom">
        <a href="/#contact" className="side-link" data-testid="link-support"><CircleHelp size={17} /><span>Support</span></a>
        <div className="profile-mini" data-testid={`profile-user-${user.id}`}><span className="avatar">{initials(user.name)}</span><span style={{ flex: 1, minWidth: 0 }}><strong>{user.name}</strong><small>{user.email}</small></span></div>
        <button className="side-link" style={{ width: '100%', border: 0, background: 'transparent', textAlign: 'left' }} onClick={() => logout.mutate()} disabled={logout.isPending} data-testid="button-logout"><LogOut size={17} /><span>{logout.isPending ? 'Signing out…' : 'Sign out'}</span></button>
        {logout.isError && <p className="error-text" role="alert">{errMsg(logout.error)}</p>}
      </div>
    </aside>
    <main className="workspace-main">{children}</main>
  </div>;
}

function PageHeader({ user, title, subtitle, page, onMenu }: { user: User; title: string; subtitle: string; page: PageKey; onMenu: () => void }) {
  return <header className="topbar">
    <div style={{ display: 'flex', gap: 11, alignItems: 'center' }}><button className="icon-button mobile-menu" aria-label="Toggle navigation" onClick={onMenu} data-testid="button-menu"><Menu size={18} /></button><div><div className="eyebrow">{ROLE_NAMES[user.role]} workspace</div><h1 data-testid={`heading-${page}`}>{title}</h1><p>{subtitle}</p></div></div>
    <div className="top-actions"><span className="pill pill-ok desktop-only"><Activity size={12} /> Connected</span><span className="avatar" aria-label={user.name}>{initials(user.name)}</span></div>
  </header>;
}

function StatusView({ user }: { user: User }) {
  const [menu, setMenu] = useState(false);
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const alerts = useListAlerts({ query: { queryKey: getListAlertsQueryKey() } });
  const items = summary.data?.recentOrders ?? [];
  const openAlerts = alerts.data?.filter((item) => !item.acknowledged).slice(0, 5) ?? [];
  return <Workspace user={user} page="dashboard">
    <PageHeader user={user} page="dashboard" onMenu={() => setMenu(!menu)} title={`Good to have you, ${user.name.split(' ')[0]}`} subtitle="A current view of your organization’s produce movement." />
    {menu && <MobileMenu setMenu={setMenu} />}
    {summary.isLoading ? <Loading rows={7} /> : summary.isError ? <ErrorBox error={summary.error} retry={() => void summary.refetch()} /> : summary.data && <div className="page-stack">
      <div className="kpi-grid">
        <Metric icon={Boxes} label="Orders in view" value={summary.data.orderCount.toLocaleString()} foot="Organization order records" />
        <Metric icon={Truck} label="Active shipments" value={summary.data.activeShipments.toLocaleString()} foot="Currently on the move" color="var(--ice)" />
        <Metric icon={Thermometer} label="Average temperature" value={`${summary.data.averageTemperatureC.toFixed(1)}°C`} foot="Shipment temperature readings" color="var(--ice)" />
        <Metric icon={Bell} label="Open alerts" value={summary.data.openAlerts.toLocaleString()} foot="Awaiting acknowledgement" color={summary.data.openAlerts ? 'var(--amber)' : 'var(--mint)'} />
      </div>
      <div className="content-grid">
        <section className="glass panel"><div className="panel-head"><div><div className="eyebrow">Latest activity</div><h2 style={{ marginTop: 5 }}>Recent orders</h2></div><Link href="/orders" className="btn btn-quiet" data-testid="link-view-orders">All orders <ArrowRight size={14} /></Link></div>
          {items.length ? <div className="table-wrap"><table style={{ minWidth: 520 }}><thead><tr><th>Order</th><th>Route</th><th>Quantity</th><th>Status</th></tr></thead><tbody>{items.slice(0, 6).map((order) => <OrderRow key={order.id} order={order} compact />)}</tbody></table></div> : <Empty title="No recent orders" body="Orders created within your organization will appear here." action={<Link href="/orders" className="btn">Open orders</Link>} />}
        </section>
        <section className="glass panel"><div className="panel-head"><div><div className="eyebrow">Needs attention</div><h2 style={{ marginTop: 5 }}>Operational alerts</h2></div><Link href="/alerts" className="icon-button" aria-label="View alerts" data-testid="link-view-alerts"><ArrowRight size={17} /></Link></div>
          {alerts.isLoading ? <div className="loading-block" style={{ padding: 0 }}><div className="skeleton" /><div className="skeleton" /></div> : alerts.isError ? <div role="alert" className="error-text">Alerts unavailable. <button className="btn btn-quiet" onClick={() => void alerts.refetch()}>Retry</button></div> : openAlerts.length ? openAlerts.map((alert) => <AlertLine key={alert.id} alert={alert} compact />) : <Empty title="No open alerts" body="You’re up to date on the current alert records." />}
        </section>
      </div>
      <section className="glass panel"><div className="panel-head"><div><div className="eyebrow">Order distribution</div><h2 style={{ marginTop: 5 }}>By status</h2></div><Link href="/orders" className="btn btn-quiet">Manage orders <ArrowRight size={14} /></Link></div>
        {summary.data.statusCounts.length ? <div className="status-flow">{summary.data.statusCounts.map((item) => <span className="status-option" key={item.status}><Pill value={item.status} /><strong style={{ marginLeft: 8 }}>{item.count}</strong></span>)}</div> : <p className="muted" data-testid="text-status-empty">Status counts are not available yet.</p>}
        <p className="row-sub" style={{ marginTop: 18 }}>Recorded revenue <strong style={{ color: 'var(--ink)' }}>PKR {money(summary.data.revenuePkr)}</strong></p>
      </section>
    </div>}
  </Workspace>;
}

function MobileMenu({ setMenu }: { setMenu: (open: boolean) => void }) {
  useEffect(() => {
    document.querySelector('.sidebar')?.classList.add('open');
    document.querySelector('.drawer-scrim')?.classList.add('open');
    return () => {
      document.querySelector('.sidebar')?.classList.remove('open');
      document.querySelector('.drawer-scrim')?.classList.remove('open');
    };
  }, [setMenu]);
  return null;
}

function Metric({ icon: Icon, label, value, foot, color }: { icon: typeof Activity; label: string; value: string; foot: string; color?: string }) {
  return <article className="glass kpi-card" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}><div className="kpi-top"><span>{label}</span><Icon size={17} color={color ?? 'var(--mint)'} /></div><div className="kpi-value">{value}</div><div className="kpi-foot">{foot}</div></article>;
}

function OrderRow({ order, compact = false, edit, remove, changeStatus }: { order: Order; compact?: boolean; edit?: (id: number) => void; remove?: (order: Order) => void; changeStatus?: (order: Order) => void }) {
  return <tr data-testid={`row-order-${order.id}`}>
    <td><div className="row-code">{order.code}</div><div className="row-sub">{order.produce}</div></td>
    <td><div className="route-line"><span>{order.pickupCity}</span><MoveRight size={13} /><span>{order.dropoffCity}</span></div>{!compact && <div className="row-sub">{order.retailerName}</div>}</td>
    <td><span className="row-main">{order.quantityKg.toLocaleString()} kg</span></td>
    {!compact && <td><span className="row-main">PKR {money(order.totalPkr)}</span></td>}
    <td><Pill value={order.status} /></td>
    {!compact && <><td><div className="action-row"><button className="small-icon" title="Change status" aria-label={`Change status ${order.code}`} onClick={() => changeStatus?.(order)} data-testid={`button-status-order-${order.id}`}><ChevronDown size={15} /></button><button className="small-icon" title="Edit order" aria-label={`Edit ${order.code}`} onClick={() => edit?.(order.id)} data-testid={`button-edit-order-${order.id}`}><Pencil size={14} /></button><button className="small-icon delete" title="Delete order" aria-label={`Delete ${order.code}`} onClick={() => remove?.(order)} data-testid={`button-delete-order-${order.id}`}><Trash2 size={14} /></button></div></td><td className="row-sub">{dateTime(order.createdAt)}</td></>}
  </tr>;
}

function OrdersPage({ user }: { user: User }) {
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<'create' | 'edit' | 'status' | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const params = useMemo<ListOrdersParams>(() => ({ page, pageSize: 10, ...(search.trim() ? { search: search.trim() } : {}), ...(status ? { status: status as OrderStatus } : {}) }), [page, search, status]);
  const query = useListOrders(params, { query: { queryKey: getListOrdersQueryKey(params), placeholderData: keepPreviousData } });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    void qc.invalidateQueries({ queryKey: getListShipmentsQueryKey() });
  };
  const create = useCreateOrder({ mutation: { mutationKey: getCreateOrderMutationKey(), onSuccess: invalidate } });
  const update = useUpdateOrder({ mutation: { mutationKey: getUpdateOrderMutationKey(), onSuccess: invalidate } });
  const remove = useDeleteOrder({ mutation: { mutationKey: getDeleteOrderMutationKey(), onSuccess: invalidate } });
  const updateStatus = useUpdateOrderStatus({ mutation: { mutationKey: getUpdateOrderStatusMutationKey(), onSuccess: invalidate } });
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / (query.data?.pageSize || 10)));
  const openEdit = (id: number) => { setSelectedId(id); setDialog('edit'); };
  return <Workspace user={user} page="orders">
    <PageHeader user={user} page="orders" onMenu={() => setMenu(!menu)} title="Orders" subtitle="Search and manage produce orders for your organization." />{menu && <MobileMenu setMenu={setMenu} />}
    <section className="glass table-panel">
      <div className="toolbar" style={{ padding: '17px 18px 0' }}><div className="toolbar-left">
        <div className="search-wrap"><Search size={16} /><input className="field" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search code, produce, city…" aria-label="Search orders" data-testid="input-search-orders" /></div>
        <select className="field status-select" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label="Filter by status" data-testid="select-order-status"><option value="">All statuses</option>{ORDER_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      </div><button className="btn btn-primary" onClick={() => setDialog('create')} data-testid="button-create-order"><Plus size={16} /> New order</button></div>
      {query.isLoading ? <Loading /> : query.isError ? <div style={{ padding: 18 }}><ErrorBox error={query.error} retry={() => void query.refetch()} /></div> : query.data?.data.length ? <>
        <div className="table-wrap"><table data-testid="table-orders"><thead><tr><th>Order</th><th>Route / retailer</th><th>Quantity</th><th>Total</th><th>Status</th><th>Actions</th><th>Created</th></tr></thead><tbody>{query.data.data.map((order) => <OrderRow key={order.id} order={order} edit={openEdit} remove={setDeleteTarget} changeStatus={(record) => { setSelectedId(record.id); setDialog('status'); }} />)}</tbody></table></div>
        <div className="pager"><button className="icon-button" disabled={page <= 1 || query.isFetching} aria-label="Previous page" onClick={() => setPage((value) => Math.max(1, value - 1))} data-testid="button-orders-previous"><ChevronLeft size={17} /></button><span className="pager-label" data-testid="text-orders-pagination">Page {query.data.page} of {pageCount} · {query.data.total} orders</span><button className="icon-button" disabled={page >= pageCount || query.isFetching} aria-label="Next page" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} data-testid="button-orders-next"><ChevronRight size={17} /></button><button className="btn" onClick={() => exportOrders(query.data?.data ?? [])} data-testid="button-export-orders">Export visible</button></div>
      </> : <div style={{ padding: 18 }}><Empty title={search || status ? 'No matching orders' : 'No orders yet'} body={search || status ? 'Adjust your search or status filter to broaden the results.' : 'Create an order to start a record for this organization.'} action={!search && !status ? <button className="btn btn-primary" onClick={() => setDialog('create')}>Create first order</button> : undefined} /></div>}
    </section>
    {dialog === 'create' && <OrderForm title="Create order" close={() => setDialog(null)} pending={create.isPending} error={create.isError ? create.error : null} submit={(data) => create.mutate({ data }, { onSuccess: () => setDialog(null) })} />}
    {dialog === 'edit' && selectedId !== null && <EditOrder id={selectedId} close={() => setDialog(null)} pending={update.isPending} error={update.isError ? update.error : null} submit={(data) => update.mutate({ id: selectedId, data }, { onSuccess: () => setDialog(null) })} />}
    {dialog === 'status' && selectedId !== null && <StatusForm order={query.data?.data.find((item) => item.id === selectedId)} close={() => setDialog(null)} pending={updateStatus.isPending} error={updateStatus.isError ? updateStatus.error : null} submit={(next) => updateStatus.mutate({ id: selectedId, data: { status: next } }, { onSuccess: () => setDialog(null) })} />}
    {deleteTarget && <Confirm title={`Delete ${deleteTarget.code}?`} body="This removes the order from this organization’s records. This cannot be undone." pending={remove.isPending} error={remove.isError ? remove.error : null} cancel={() => { setDeleteTarget(null); remove.reset(); }} confirm={() => remove.mutate({ id: deleteTarget.id }, { onSuccess: () => { setDeleteTarget(null); remove.reset(); } })} />}
  </Workspace>;
}

function exportOrders(orders: Order[]) {
  if (!orders.length) return;
  const keys: Array<keyof Order> = ['code', 'produce', 'quantityKg', 'pickupCity', 'dropoffCity', 'totalPkr', 'status', 'retailerName', 'createdAt'];
  const text = [keys.join(','), ...orders.map((order) => keys.map((key) => `"${String(order[key]).replaceAll('"', '""')}"`).join(','))].join('\n');
  const href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = href; link.download = 'agrisupply-visible-orders.csv'; link.click(); URL.revokeObjectURL(href);
}

function Dialog({ title, description, close, children }: { title: string; description: string; close: () => void; children: ReactNode }) {
  useEffect(() => { const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); }; window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown); }, [close]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="glass modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-title"><div><h2>{title}</h2><p>{description}</p></div><button className="icon-button" aria-label="Close dialog" onClick={close} data-testid="button-close-dialog"><X size={17} /></button></div>{children}</section></div>;
}
function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return <label className="form-field"><span className="field-label">{label}{required ? ' *' : ''}</span>{children}</label>;
}

type OrderFormProps = { title: string; initial?: Partial<Order>; close: () => void; pending: boolean; error: unknown; submit: (data: OrderInput) => void };
function OrderForm({ title, initial, close, pending, error, submit }: OrderFormProps) {
  const [form, setForm] = useState({ produce: initial?.produce ?? '', quantity: initial?.quantityKg ? String(initial.quantityKg) : '', pickup: initial?.pickupCity ?? '', dropoff: initial?.dropoffCity ?? '', total: initial?.totalPkr ? String(initial.totalPkr) : '', retailer: initial?.retailerName ?? '' });
  const change = (key: keyof typeof form, value: string) => setForm((state) => ({ ...state, [key]: value }));
  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit({ produce: form.produce.trim(), quantityKg: Number(form.quantity), pickupCity: form.pickup.trim(), dropoffCity: form.dropoff.trim(), totalPkr: Number(form.total), retailerName: form.retailer.trim() });
  };
  return <Dialog title={title} description="Record produce, volume, route and retailer details." close={close}><form onSubmit={send}><div className="form-grid">
    <Field label="Produce" required><input className="field" required minLength={2} maxLength={60} value={form.produce} onChange={(e) => change('produce', e.target.value)} placeholder="Kinnow" data-testid="input-order-produce" /></Field>
    <Field label="Quantity (kg)" required><input className="field" required type="number" min="1" max="1000000" value={form.quantity} onChange={(e) => change('quantity', e.target.value)} data-testid="input-order-quantity" /></Field>
    <Field label="Pickup city" required><input className="field" required minLength={2} maxLength={100} value={form.pickup} onChange={(e) => change('pickup', e.target.value)} data-testid="input-order-pickup" /></Field>
    <Field label="Drop-off city" required><input className="field" required minLength={2} maxLength={100} value={form.dropoff} onChange={(e) => change('dropoff', e.target.value)} data-testid="input-order-dropoff" /></Field>
    <Field label="Total (PKR)" required><input className="field" required type="number" min="1" max="1000000000" value={form.total} onChange={(e) => change('total', e.target.value)} data-testid="input-order-total" /></Field>
    <Field label="Retailer name" required><input className="field" required minLength={2} maxLength={100} value={form.retailer} onChange={(e) => change('retailer', e.target.value)} data-testid="input-order-retailer" /></Field>
  </div>{Boolean(error) && <p className="error-text" role="alert">{errMsg(error)}</p>}<div className="modal-actions"><button type="button" className="btn" onClick={close} data-testid="button-cancel-order">Cancel</button><button className="btn btn-primary" disabled={pending} data-testid="button-submit-order">{pending ? 'Saving…' : 'Save order'}</button></div></form></Dialog>;
}
function EditOrder({ id, ...props }: Omit<OrderFormProps, 'title' | 'initial'> & { id: number }) {
  const order = useGetOrder(id, { query: { queryKey: getGetOrderQueryKey(id) } });
  if (order.isLoading) return <Dialog title="Edit order" description="Loading the selected order record." close={props.close}><Loading rows={4} /></Dialog>;
  if (order.isError || !order.data) return <Dialog title="Edit order" description="The order record could not be loaded." close={props.close}><ErrorBox error={order.error} retry={() => void order.refetch()} /></Dialog>;
  return <OrderForm title={`Edit ${order.data.code}`} initial={order.data} {...props} />;
}
function StatusForm({ order, close, pending, error, submit }: { order?: Order; close: () => void; pending: boolean; error: unknown; submit: (status: OrderStatus) => void }) {
  const [next, setNext] = useState<OrderStatus>(order?.status ?? OrderStatusEnum.Placed);
  return <Dialog title={order ? `Update ${order.code}` : 'Update order status'} description="Select a status. The service validates each workflow transition." close={close}>
    {!order ? <Empty title="Order not found" body="Refresh the order list and try again." /> : <><div className="status-flow">{ORDER_STATUSES.map((value) => <button key={value} className={cx('status-option', next === value && 'selected')} onClick={() => setNext(value)} data-testid={`option-status-${value.toLowerCase().replaceAll(' ', '-')}`}>{value}</button>)}</div>{Boolean(error) && <p className="error-text" role="alert">{errMsg(error)}</p>}<div className="modal-actions"><button className="btn" onClick={close}>Cancel</button><button className="btn btn-primary" disabled={pending || next === order.status} onClick={() => submit(next)} data-testid="button-save-order-status">{pending ? 'Updating…' : 'Update status'}</button></div></>}
  </Dialog>;
}
function Confirm({ title, body, pending, error, cancel, confirm }: { title: string; body: string; pending: boolean; error: unknown; cancel: () => void; confirm: () => void }) {
  return <Dialog title={title} description={body} close={cancel}><span className="pill pill-bad"><Trash2 size={12} /> Permanent change</span>{Boolean(error) && <p className="error-text" role="alert">{errMsg(error)}</p>}<div className="modal-actions"><button className="btn" onClick={cancel} data-testid="button-cancel-delete">Keep order</button><button className="btn btn-danger" onClick={confirm} disabled={pending} data-testid="button-confirm-delete">{pending ? 'Deleting…' : 'Delete order'}</button></div></Dialog>;
}

function ShipmentCard({ shipment }: { shipment: Shipment }) {
  return <article className="glass shipment-card" data-testid={`card-shipment-${shipment.id}`}>
    <div className="panel-head" style={{ marginBottom: 0 }}><div><div className="eyebrow">{shipment.orderCode}</div><div className="row-main" style={{ marginTop: 6 }}>{shipment.truckPlate}</div></div><Pill value={shipment.status} /></div>
    <div className="shipment-route"><div><small>Pickup</small><strong>{shipment.pickupCity}</strong></div><MoveRight size={17} color="var(--ice)" /><div><small>Drop-off</small><strong>{shipment.dropoffCity}</strong></div></div>
    <div className="shipment-meta"><div><small>Driver</small><strong>{shipment.driverName}</strong></div><div><small>Temperature</small><strong className="temp-read">{shipment.temperatureC.toFixed(1)}°C</strong></div><div><small>ETA</small><strong>{dateTime(shipment.eta)}</strong></div><div><small>Assigned</small><strong>{dateTime(shipment.createdAt)}</strong></div></div>
  </article>;
}
function ShipmentForm({ close, pending, error, submit }: { close: () => void; pending: boolean; error: unknown; submit: (data: ShipmentInput) => void }) {
  const orders = useListOrders({ page: 1, pageSize: 100 }, { query: { queryKey: getListOrdersQueryKey({ page: 1, pageSize: 100 }) } });
  const [id, setId] = useState('');
  const [truck, setTruck] = useState('');
  const [driver, setDriver] = useState('');
  const [eta, setEta] = useState('');
  const assignable = orders.data?.data.filter((order) => ![OrderStatusEnum.Delivered, OrderStatusEnum.Rejected].includes(order.status as never)) ?? [];
  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit({ orderId: Number(id), truckPlate: truck.trim(), driverName: driver.trim(), eta: new Date(eta).toISOString() });
  }
  return <Dialog title="Assign shipment" description="Attach a truck, driver and estimated arrival to an existing order." close={close}>
    {orders.isLoading ? <Loading rows={3} /> : orders.isError ? <ErrorBox error={orders.error} retry={() => void orders.refetch()} /> : !assignable.length ? <Empty title="No assignable orders found" body="An order must exist in this organization before you can assign its shipment." /> : <form onSubmit={send}><div className="form-grid">
      <Field label="Order" required><select className="field" required value={id} onChange={(e) => setId(e.target.value)} data-testid="select-shipment-order"><option value="">Select an order</option>{assignable.map((order) => <option key={order.id} value={order.id}>{order.code} · {order.produce} · {order.pickupCity} to {order.dropoffCity}</option>)}</select></Field>
      <Field label="Truck plate" required><input className="field" required minLength={3} maxLength={20} value={truck} onChange={(e) => setTruck(e.target.value)} data-testid="input-shipment-truck" /></Field>
      <Field label="Driver name" required><input className="field" required minLength={2} maxLength={100} value={driver} onChange={(e) => setDriver(e.target.value)} data-testid="input-shipment-driver" /></Field>
      <Field label="Estimated arrival" required><input className="field" type="datetime-local" required value={eta} onChange={(e) => setEta(e.target.value)} data-testid="input-shipment-eta" /></Field>
    </div>{Boolean(error) && <p className="error-text" role="alert">{errMsg(error)}</p>}<div className="modal-actions"><button type="button" className="btn" onClick={close}>Cancel</button><button className="btn btn-primary" disabled={pending || !id} data-testid="button-submit-shipment">{pending ? 'Assigning…' : 'Assign shipment'}</button></div></form>}
  </Dialog>;
}

function ShipmentsPage({ user }: { user: User }) {
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState('');
  const [assign, setAssign] = useState(false);
  const params = useMemo(() => search.trim() ? { search: search.trim() } : undefined, [search]);
  const shipments = useListShipments(params, { query: { queryKey: getListShipmentsQueryKey(params) } });
  const create = useCreateShipment({ mutation: { mutationKey: getCreateShipmentMutationKey(), onSuccess: () => {
    void qc.invalidateQueries({ queryKey: getListShipmentsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  } } });
  return <Workspace user={user} page="shipments"><PageHeader user={user} page="shipments" onMenu={() => setMenu(!menu)} title="Shipments" subtitle="Review assigned trips, temperature readings and estimated arrival." />{menu && <MobileMenu setMenu={setMenu} />}
    <div className="page-stack"><div className="toolbar"><div className="search-wrap"><Search size={16} /><input className="field" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search truck, driver, order, city…" aria-label="Search shipments" data-testid="input-search-shipments" /></div><button className="btn btn-primary" onClick={() => setAssign(true)} data-testid="button-assign-shipment"><Plus size={16} /> Assign shipment</button></div>
      {shipments.isLoading ? <Loading rows={6} /> : shipments.isError ? <ErrorBox error={shipments.error} retry={() => void shipments.refetch()} /> : shipments.data?.length ? <div className="shipment-grid">{shipments.data.map((shipment) => <ShipmentCard key={shipment.id} shipment={shipment} />)}</div> : <Empty title={search ? 'No matching shipments' : 'No shipments assigned'} body={search ? 'Try another truck, order or city.' : 'Assigned trips will appear here as organization records.'} action={!search ? <button className="btn btn-primary" onClick={() => setAssign(true)}>Assign a shipment</button> : undefined} />}
    </div>
    {assign && <ShipmentForm close={() => { setAssign(false); create.reset(); }} pending={create.isPending} error={create.isError ? create.error : null} submit={(data) => create.mutate({ data }, { onSuccess: () => { setAssign(false); create.reset(); } })} />}
  </Workspace>;
}

function AlertLine({ alert, compact, ack, pending, error }: { alert: Alert; compact?: boolean; ack?: () => void; pending?: boolean; error?: unknown }) {
  const level = alert.severity.toLowerCase();
  return <div className="alert-item" data-testid={`alert-row-${alert.id}`}><span className={`severity-dot ${level}`} /><div className="alert-copy"><strong>{alert.title}</strong><small>{level} · {dateTime(alert.createdAt)}</small>{Boolean(error) && <div className="error-text" role="alert">{errMsg(error)}</div>}</div>
    {alert.acknowledged ? <span className="pill pill-ok"><Check size={12} /> Acknowledged</span> : ack ? <button className="btn" style={{ minHeight: 34, padding: '.45rem .7rem', fontSize: '.68rem' }} onClick={ack} disabled={pending} data-testid={`button-ack-alert-${alert.id}`}>{pending ? 'Saving…' : 'Acknowledge'}</button> : compact ? <span className="pill pill-warn">Open</span> : null}
  </div>;
}
function AlertsPage({ user }: { user: User }) {
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);
  const alerts = useListAlerts({ query: { queryKey: getListAlertsQueryKey() } });
  const acknowledge = useAcknowledgeAlert({ mutation: { mutationKey: getAcknowledgeAlertMutationKey(), onSuccess: () => {
    void qc.invalidateQueries({ queryKey: getListAlertsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  } } });
  const records = alerts.data ?? [];
  const open = records.filter((alert) => !alert.acknowledged);
  const done = records.filter((alert) => alert.acknowledged);
  return <Workspace user={user} page="alerts"><PageHeader user={user} page="alerts" onMenu={() => setMenu(!menu)} title="Alerts" subtitle="Review and acknowledge operational alerts returned for your organization." />{menu && <MobileMenu setMenu={setMenu} />}
    {alerts.isLoading ? <Loading rows={6} /> : alerts.isError ? <ErrorBox error={alerts.error} retry={() => void alerts.refetch()} /> : <div className="page-stack">
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))', maxWidth: 540 }}><Metric icon={Bell} label="Open alerts" value={String(open.length)} foot="Awaiting acknowledgement" color={open.length ? 'var(--amber)' : 'var(--mint)'} /><Metric icon={CheckCircle2} label="Acknowledged" value={String(done.length)} foot="Already reviewed" color="var(--ice)" /></div>
      <section className="glass panel"><div className="panel-head"><div><div className="eyebrow">Attention required</div><h2 style={{ marginTop: 5 }}>Open alerts</h2></div><span className="pill pill-warn">{open.length} open</span></div>{open.length ? open.map((alert) => <AlertLine key={alert.id} alert={alert} ack={() => acknowledge.mutate({ id: alert.id })} pending={acknowledge.isPending && acknowledge.variables?.id === alert.id} error={acknowledge.isError && acknowledge.variables?.id === alert.id ? acknowledge.error : undefined} />) : <Empty title="Nothing needs acknowledgement" body="There are no open alerts in the current service response." />}</section>
      {done.length > 0 && <section className="glass panel"><div className="panel-head"><div><div className="eyebrow">Reviewed</div><h2 style={{ marginTop: 5 }}>Acknowledged alerts</h2></div></div>{done.map((alert) => <AlertLine key={alert.id} alert={alert} />)}</section>}
    </div>}
  </Workspace>;
}

function LoginPage({ mode: initialMode }: { mode: 'login' | 'signup' }) {
  const [mode, setMode] = useState(initialMode);
  const [shown, setShown] = useState(false);
  const [fields, setFields] = useState({ name: '', email: '', password: '', organization: '', city: '' });
  const [, go] = useLocation();
  const qc = useQueryClient();
  const success = (user: User) => { qc.setQueryData(getGetCurrentUserQueryKey(), user); go(ROLE_ROUTES[user.role]); };
  const login = useLogin({ mutation: { onSuccess: (session) => success(session.user) } });
  const signup = useSignup({ mutation: { onSuccess: (session) => success(session.user) } });
  useEffect(() => setMode(initialMode), [initialMode]);
  const update = (key: keyof typeof fields, value: string) => setFields((old) => ({ ...old, [key]: value }));
  const error = mode === 'login' ? login.error : signup.error;
  const pending = login.isPending || signup.isPending;
  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === 'login') login.mutate({ data: { email: fields.email.trim(), password: fields.password } });
    else signup.mutate({ data: { name: fields.name.trim(), email: fields.email.trim(), password: fields.password, organizationName: fields.organization.trim(), city: fields.city.trim() } });
  }
  return <div className="app-shell grain auth-page"><section className="auth-visual"><div className="auth-visual-content"><Brand /><div className="eyebrow" style={{ marginTop: 34 }}>Cold-chain operations workspace</div><h1>Every degree matters.</h1><p className="muted" style={{ maxWidth: 430, lineHeight: 1.8 }}>Sign in to follow produce orders, shipment temperatures and arrival estimates across your organization.</p><div style={{ marginTop: 20 }}><ApiBadge /></div></div></section>
    <main className="auth-form-side"><section className="glass auth-card"><div className="eyebrow">Secure organization access</div><h2 style={{ marginTop: 8 }}>{mode === 'login' ? 'Welcome back' : 'Create your workspace'}</h2><p className="muted" style={{ margin: '7px 0 0', fontSize: '.8rem' }}>{mode === 'login' ? 'Use your account email and password to continue.' : 'Create an organization and its first warehouse administrator.'}</p>
      <div className="auth-tabs"><button type="button" className={mode === 'login' ? 'selected' : ''} onClick={() => { setMode('login'); login.reset(); signup.reset(); }} data-testid="tab-login">Sign in</button><button type="button" className={mode === 'signup' ? 'selected' : ''} onClick={() => { setMode('signup'); login.reset(); signup.reset(); }} data-testid="tab-signup">Create account</button></div>
      <form onSubmit={send} data-testid="form-auth">{mode === 'signup' && <div className="form-grid">
        <Field label="Full name" required><input className="field" required minLength={2} maxLength={100} autoComplete="name" value={fields.name} onChange={(e) => update('name', e.target.value)} data-testid="input-full-name" /></Field>
        <Field label="Organization" required><input className="field" required minLength={2} maxLength={150} value={fields.organization} onChange={(e) => update('organization', e.target.value)} data-testid="input-organization" /></Field>
        <div className="form-field full"><Field label="City" required><input className="field" required minLength={2} maxLength={100} autoComplete="address-level2" value={fields.city} onChange={(e) => update('city', e.target.value)} data-testid="input-city" /></Field></div>
      </div>}
      <div className="form-field" style={{ marginTop: mode === 'signup' ? 13 : 0 }}><Field label="Email address" required><input className="field" type="email" required maxLength={255} autoComplete="email" value={fields.email} onChange={(e) => update('email', e.target.value)} data-testid="input-email" /></Field></div>
      <div className="form-field" style={{ marginTop: 13 }}><Field label="Password" required><div className="password-wrap"><input className="field" type={shown ? 'text' : 'password'} required minLength={8} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={fields.password} onChange={(e) => update('password', e.target.value)} data-testid="input-password" /><button type="button" className="password-toggle" onClick={() => setShown(!shown)} aria-pressed={shown} aria-label={shown ? 'Hide password' : 'Show password'} data-testid="button-toggle-password">{shown ? <><EyeOff size={14} /> Hide</> : <><Eye size={14} /> Show</>}</button></div></Field></div>
      {Boolean(error) && <p className="error-text" role="alert" data-testid="text-auth-error">{errMsg(error)}</p>}
      <button className="btn btn-primary" style={{ width: '100%', marginTop: 20 }} disabled={pending} data-testid="button-auth-submit">{pending ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create organization'} <ArrowRight size={16} /></button></form>
      <div className="auth-foot">Private organization access. Your records are scoped to your signed-in organization.</div>
    </section></main>
  </div>;
}

function PublicNav() {
  const [open, setOpen] = useState(false);
  const links = [['#features', 'Features'], ['#workflow', 'Workflow'], ['#roles', 'Roles'], ['#contact', 'Contact']];
  return <nav className="public-nav"><Brand /><div className="public-nav-links">{links.map(([href, text]) => <a key={href} href={href}>{text}</a>)}<Link href="/login" data-testid="link-login">Sign in</Link></div><div style={{ display: 'flex', gap: 8 }}><Link href="/login" className="btn btn-primary" data-testid="link-dashboard">Open workspace <ArrowRight size={14} /></Link><button className="icon-button mobile-menu" aria-label="Toggle site menu" onClick={() => setOpen(!open)} data-testid="button-site-menu"><Menu size={18} /></button></div>{open && <div className="glass" style={{ position: 'absolute', right: 18, top: 65, display: 'grid', gap: 14, padding: 15, minWidth: 180 }}>{[...links, ['/login', 'Sign in']].map(([href, text]) => <a key={href} href={href} onClick={() => setOpen(false)}>{text}</a>)}</div>}</nav>;
}

function Landing() {
  const [chatOpen, setChatOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Array<{ text: string; who: 'bot' | 'user' }>>([{ text: 'Assalam o Alaikum. Ask me about the order, shipment and alert views in AgriSupply.', who: 'bot' }]);
  const topics = ['Orders', 'Shipment temperature', 'Alerts', 'Account access'];
  const answer = (text: string) => {
    const q = text.toLowerCase();
    if (/track|shipment|truck|eta/.test(q)) return 'Shipment records include order code, truck and driver, route, temperature reading and estimated arrival. Sign in to see your organization’s records.';
    if (/temp|temperature|cold/.test(q)) return 'The workspace displays temperature readings recorded with shipment data and operational alerts returned by the service.';
    if (/order|produce/.test(q)) return 'Order records keep produce, quantity, pickup and drop-off cities, retailer, total and current workflow status together.';
    if (/alert/.test(q)) return 'In Alerts, review open service alerts and acknowledge them. The organization alert list refreshes after the update.';
    if (/login|account|sign/.test(q)) return 'Sign in to access an existing organization or create an account to set up a new workspace.';
    return 'I can explain orders, shipment records, temperature readings, alerts and account access.';
  };
  const send = (text = input) => {
    const q = text.trim(); if (!q) return;
    setMessages((old) => [...old, { text: q, who: 'user' }, { text: answer(q), who: 'bot' }]); setInput('');
  };
  function contact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = encodeURIComponent(`${String(data.get('message'))}\n\nReply to: ${String(data.get('email'))}`);
    window.location.href = `mailto:hello@agrisupply.pk?subject=${encodeURIComponent(`AgriSupply inquiry from ${String(data.get('name'))}`)}&body=${body}`;
  }
  const feature = [
    [ClipboardList, 'Order management', 'Create and follow produce orders through the supported status workflow.'],
    [Thermometer, 'Temperature context', 'See the temperature reading returned with each assigned shipment.'],
    [RouteIcon, 'Shipment assignments', 'Keep order, truck, driver, route and estimated arrival together.'],
    [Bell, 'Operational alerts', 'Review open alerts and record acknowledgement for your team.'],
    [ShieldCheck, 'Role-aware entry', 'Farmer, transporter, warehouse and retailer roles have their own entry point.'],
    [Search, 'Record search', 'Find orders and shipments by details your operations team knows.'],
    [Activity, 'Organization summary', 'See summary counts and recent activity returned by the service.'],
    [Warehouse, 'Tenant workspace', 'Keep the organization’s operational data in one place.'],
  ] as const;
  return <div className="app-shell grain"><PublicNav /><main>
    <section className="landing-hero"><div className="landing-inner"><div className="landing-copy"><span className="pill pill-ok">Produce operations, connected</span><h1>Farm to city.<br /><em>Temperature in view.</em></h1><p>AgriSupply brings produce orders, assigned cold-chain shipments, recorded temperatures and operational alerts into one organization workspace — made for the people moving Pakistan’s harvest.</p><div className="landing-cta"><Link href="/signup" className="btn btn-primary" data-testid="link-start-workspace">Create a workspace <ArrowRight size={16} /></Link><a href="#workflow" className="btn">See how it works <ArrowRight size={15} /></a></div><div style={{ marginTop: 24 }}><ApiBadge /></div></div>
      <div className="glass live-card" data-testid="card-shipment-preview"><div className="live-card-head"><span>Shipment record</span><span className="pill pill-info">Illustrative</span></div><p className="row-sub" style={{ marginTop: 12 }}>An at-a-glance trip record</p><div className="live-temp"><Thermometer size={44} strokeWidth={1.5} /></div><div className="row-sub">Temperature reading · shipment data</div><div className="temp-track" style={{ margin: '17px 0 8px' }}><span /></div><div className="live-row"><span>Vehicle</span><strong>Assigned truck</strong></div><div className="live-row"><span>Route</span><strong>Pickup <MoveRight size={12} /> drop-off</strong></div><div className="live-row"><span>Estimated arrival</span><strong>Shipment ETA</strong></div><div className="row-sub" style={{ marginTop: 9 }}>Organization records appear after sign-in.</div></div>
    </div></section>
    <div className="section" style={{ paddingTop: 0, paddingBottom: 24 }}><div className="section-inner"><div className="stat-strip"><div className="stat-tile"><strong><ClipboardList size={22} /></strong><span>Organization orders</span></div><div className="stat-tile"><strong><Truck size={22} /></strong><span>Assigned shipments</span></div><div className="stat-tile"><strong><Thermometer size={22} /></strong><span>Temperature readings</span></div><div className="stat-tile"><strong><Bell size={22} /></strong><span>Operational alerts</span></div></div></div></div>
    <section className="section" id="features"><div className="section-inner"><div className="section-head"><span className="eyebrow">Built for the cold chain</span><h2>One clear record from order to arrival.</h2><p>Keep the information people need at hand. Each operations view is scoped to your signed-in organization.</p></div><div className="feature-grid">{feature.map(([Icon, title, text]) => <article key={title} className="glass feature-card" data-testid={`feature-${title.toLowerCase().replaceAll(' ', '-')}`}><div className="feature-icon"><Icon size={18} /></div><h3>{title}</h3><p>{text}</p></article>)}</div></div></section>
    <section className="section workflow" id="workflow"><div className="section-inner"><div className="section-head"><span className="eyebrow">Workflow</span><h2>A crate’s route, without the guesswork.</h2><p>Bring the main checkpoints into a shared operational picture.</p></div><div className="workflow-list">{[['01', 'Order placed', 'Capture produce, volume, retailer and delivery route.'], ['02', 'Order confirmed', 'Review the order and advance its supported status.'], ['03', 'Shipment assigned', 'Attach truck, driver and estimated arrival to an order.'], ['04', 'Temperature recorded', 'Review the temperature value alongside its shipment.'], ['05', 'Alert acknowledged', 'Close the loop when an operational alert is reviewed.']].map(([num, title, text]) => <article key={num} className="glass workflow-step"><span className="step-num">{num} / STEP</span><h3>{title}</h3><p>{text}</p></article>)}</div></div></section>
    <section className="section"><div className="section-inner story-split"><img src="/assets/img/coldroom.jpg" loading="lazy" alt="Produce crates inside a cold storage room" data-testid="img-coldroom" /><div><span className="eyebrow">Why AgriSupply</span><h2>Clear handoffs make better cold-chain work.</h2><p className="muted" style={{ lineHeight: 1.8, fontSize: '.86rem' }}>Farmers, transporters, warehouse teams and retailers each have a part in getting produce to market. AgriSupply keeps your organization’s orders, shipments and operational alerts in one practical workspace.</p><div className="check-list"><div><CheckCircle2 size={16} className="check-mark" /> Orders tied to a clear route and retailer</div><div><CheckCircle2 size={16} className="check-mark" /> Shipment details with driver and temperature</div><div><CheckCircle2 size={16} className="check-mark" /> Alert acknowledgement for the team</div><div><CheckCircle2 size={16} className="check-mark" /> Role-specific dashboard entry</div></div><Link href="/signup" className="btn btn-primary" style={{ marginTop: 25 }}>Set up your workspace <ArrowRight size={15} /></Link></div></div></section>
    <section className="section workflow" id="roles"><div className="section-inner"><div className="section-head"><span className="eyebrow">Built for everyone</span><h2>Four roles. One shared supply chain.</h2><p>Each account lands in the workspace for its assigned role.</p></div><div className="role-grid">{[[Sprout, 'Farmer', 'Keep produce orders and their status close to the source.'], [Truck, 'Transporter', 'Review assigned trips, route details and recorded readings.'], [Warehouse, 'Warehouse admin', 'Coordinate organization orders, shipment assignment and alerts.'], [Package, 'Retailer', 'Follow orders and shipment records connected to your organization.']].map(([Icon, title, text]) => { const RoleIcon = Icon as typeof Sprout; return <article className="glass role-card" key={title as string}><div className="feature-icon"><RoleIcon size={18} /></div><h3>{title as string}</h3><p>{text as string}</p></article>; })}</div></div></section>
    <section className="section"><div className="section-inner"><div className="section-head"><span className="eyebrow">Organization workspace</span><h2>Start with your supply chain.</h2><p>Create an organization account to enter the workspace. Subscription and plan details are not shown here.</p></div><div className="plans-grid"><article className="glass plan-card"><span className="pill pill-info">Operations</span><h3 style={{ marginTop: 15 }}>Team workspace</h3><div className="plan-price">Create account</div><p className="muted" style={{ fontSize: '.75rem', lineHeight: 1.7 }}>Set up an organization and its initial warehouse administrator.</p><Link href="/signup" className="btn" style={{ marginTop: 15 }}>Get started <ArrowRight size={14} /></Link></article><article className="glass plan-card featured"><span className="pill pill-ok">Four roles</span><h3 style={{ marginTop: 15 }}>One connected view</h3><div className="plan-price">Orders + trips</div><p className="muted" style={{ fontSize: '.75rem', lineHeight: 1.7 }}>Operational data is presented from signed-in organization records.</p><Link href="/login" className="btn btn-primary" style={{ marginTop: 15 }}>Sign in <ArrowRight size={14} /></Link></article><article className="glass plan-card"><span className="pill pill-neutral">Need a hand?</span><h3 style={{ marginTop: 15 }}>Talk with the team</h3><div className="plan-price">Contact</div><p className="muted" style={{ fontSize: '.75rem', lineHeight: 1.7 }}>Ask about using AgriSupply for your produce operations in Pakistan.</p><a href="#contact" className="btn" style={{ marginTop: 15 }}>Contact AgriSupply <ArrowRight size={14} /></a></article></div></div></section>
    <section className="section workflow"><div className="section-inner"><div className="section-head"><span className="eyebrow">Designed for clear handoffs</span><h2>From farm pickup to city receiving.</h2><p>Built around practical records rather than promises about data that is not in the system.</p></div><div className="quote-grid"><article className="glass quote-card"><blockquote>“Keep route, quantity and retailer details in a single record your team can find.”</blockquote><p>Order workspace</p></article><article className="glass quote-card"><blockquote>“See truck, driver, arrival estimate and recorded temperature together.”</blockquote><p>Shipment workspace</p></article><article className="glass quote-card"><blockquote>“Keep operational alerts visible until someone acknowledges them.”</blockquote><p>Alert workspace</p></article></div></div></section>
    <section className="section" id="contact"><div className="section-inner contact-grid"><div><span className="eyebrow">Contact</span><h2 style={{ fontSize: 'clamp(2rem,4vw,3.3rem)', letterSpacing: '-.07em', lineHeight: 1.05 }}>Let’s cool your supply chain.</h2><p className="muted" style={{ lineHeight: 1.85, fontSize: '.82rem' }}>Talk to AgriSupply about produce orders and cold-chain operations in Pakistan.</p><div className="check-list"><div><MapPin size={16} className="check-mark" /> Gulberg III, Lahore</div><div><MessageCircle size={16} className="check-mark" /> WhatsApp +92 307 9729471</div><a href="mailto:hello@agrisupply.pk" className="inline-link" data-testid="link-contact-email">hello@agrisupply.pk</a></div></div><form className="glass panel" onSubmit={contact} data-testid="form-contact"><div className="form-grid"><Field label="Name" required><input className="field" name="name" required minLength={2} maxLength={80} autoComplete="name" data-testid="input-contact-name" /></Field><Field label="Email" required><input className="field" name="email" type="email" required maxLength={120} autoComplete="email" data-testid="input-contact-email" /></Field><div className="form-field full"><Field label="Message" required><textarea className="field" name="message" required minLength={10} maxLength={1000} rows={4} style={{ resize: 'vertical' }} data-testid="input-contact-message" /></Field></div></div><button className="btn btn-primary" style={{ marginTop: 15 }} data-testid="button-contact-send">Prepare email <Send size={14} /></button><p className="row-sub" style={{ marginTop: 10 }}>Your email app will open with this message addressed to AgriSupply.</p></form></div></section>
  </main>
  <footer className="site-footer"><div className="site-footer-inner"><Brand /><span>AgriSupply Cold-Chain · Pakistan</span><a href="https://wa.me/923079729471?text=Hi%20AgriSupply%2C%20I%20need%20help%20with%20cold-chain%20logistics." target="_blank" rel="noreferrer" data-testid="link-whatsapp-footer">WhatsApp support</a></div></footer>
  <a className="fab fab-whatsapp" href="https://wa.me/923079729471?text=Hi%20AgriSupply%2C%20I%20need%20help%20with%20cold-chain%20logistics." target="_blank" rel="noreferrer" aria-label="Message AgriSupply on WhatsApp" data-testid="button-whatsapp"><MessageCircle size={21} /></a>
  <button className="fab fab-bot" onClick={() => setChatOpen(!chatOpen)} aria-label={chatOpen ? 'Close assistant' : 'Open AI assistant'} aria-expanded={chatOpen} data-testid="button-open-assistant"><CircleHelp size={21} /></button>
  <section className={cx('glass chat-panel', chatOpen && 'open')} aria-label="AgriSupply assistant" aria-hidden={!chatOpen} data-testid="panel-assistant"><header className="chat-header"><div><strong style={{ fontSize: '.8rem' }}>AgriSupply Assistant</strong><div className="row-sub">On-device information helper</div></div><button className="icon-button" aria-label="Close assistant" onClick={() => setChatOpen(false)} data-testid="button-close-assistant"><X size={16} /></button></header><div className="chat-messages" aria-live="polite">{messages.map((message, i) => <div key={`${i}-${message.who}`} className={cx('chat-message', message.who === 'user' && 'user')}>{message.text}</div>)}</div><div className="chat-chips">{topics.map((topic) => <button key={topic} className="chat-chip" onClick={() => send(topic)}>{topic}</button>)}</div><form className="chat-input-row" onSubmit={(event) => { event.preventDefault(); send(); }}><input className="field" maxLength={300} placeholder="Ask about the workspace…" aria-label="Ask the assistant" value={input} onChange={(e) => setInput(e.target.value)} data-testid="input-assistant-message" /><button className="btn btn-primary" aria-label="Send message" data-testid="button-assistant-send"><Send size={15} /></button></form></section>
  </div>;
}

function DashboardRoute() { return <Guard>{(user) => <StatusView user={user} />}</Guard>; }
function OrdersRoute() { return <Guard>{(user) => <OrdersPage user={user} />}</Guard>; }
function ShipmentsRoute() { return <Guard>{(user) => <ShipmentsPage user={user} />}</Guard>; }
function AlertsRoute() { return <Guard>{(user) => <AlertsPage user={user} />}</Guard>; }
function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function AppRoutes() {
  return <RouteErrorBoundary><Switch>
    <Route path="/" component={Landing} />
    <Route path="/login">{() => <LoginPage mode="login" />}</Route>
    <Route path="/signup">{() => <LoginPage mode="signup" />}</Route>
    <Route path="/dashboard" component={AuthRedirect} />
    <Route path="/farmer" component={DashboardRoute} />
    <Route path="/transporter" component={DashboardRoute} />
    <Route path="/warehouse" component={DashboardRoute} />
    <Route path="/retailer" component={DashboardRoute} />
    <Route path="/orders" component={OrdersRoute} />
    <Route path="/shipments" component={ShipmentsRoute} />
    <Route path="/alerts" component={AlertsRoute} />
    <Route component={NotFound} />
  </Switch></RouteErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AppRoutes /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;