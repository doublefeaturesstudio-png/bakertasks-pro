import { useState, useEffect, useMemo, useRef } from "react";

/* ===================================================================
   Types & Data
   =================================================================== */

interface Order {
  id: string;
  customer: string;
  cake: string;
  date: string;
  price: number;
  done: boolean;
}

interface PriceSuggestion {
  tier: string;
  label: string;
  multiplier: number;
  amount: number;
  badge?: string;
}

type Tab = "dashboard" | "orders" | "ai" | "catalogue";

interface CatalogueItem {
  id: string;
  name: string;
  sizes: Record<string, number>;
  description: string;
  category: string;
  photo?: string;
}

const STORAGE_KEY = "bakerTasksOrders";

function loadOrders(): Order[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

const CATALOGUE_KEY = "bakerTasksCatalogue";

function loadCatalogue(): CatalogueItem[] {
  try {
    const raw = localStorage.getItem(CATALOGUE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.length > 0) {
        // Deduplicate by id to clean up any stale duplicates
        const seen = new Set<string>();
        const deduped = parsed.filter((item: CatalogueItem) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
        if (deduped.length !== parsed.length) {
          localStorage.setItem(CATALOGUE_KEY, JSON.stringify(deduped));
        }
        return deduped;
      }
      // If it's empty, fall through to seeds
    }
    // Seed demo data for first visit
    const seeds: CatalogueItem[] = [
      { id: "demo-c1", name: "Single Layer Cake - Vanilla", sizes: { "6inch": 12000, "8inch": 15500, "10inch": 20000 }, description: "Moist vanilla cake. Perfect for birthdays. Add custom text +NGN 1,000", category: "Cakes" },
      { id: "demo-c2", name: "Single Layer Cake - Chocolate", sizes: { "6inch": 14000, "8inch": 17500, "10inch": 22000 }, description: "Rich chocolate cake with chocolate ganache", category: "Cakes" },
      { id: "demo-c3", name: "Single Layer Cake - Red Velvet", sizes: { "6inch": 15000, "8inch": 18500, "10inch": 23000 }, description: "Classic red velvet with cream cheese frosting", category: "Cakes" },
      { id: "demo-c4", name: "Two Tier Cartoon Character Cake", sizes: { "Standard": 60000 }, description: "8inch + 6inch. Includes basic fondant + character topper", category: "Cakes" },
      { id: "demo-c5", name: "Three Tier Wedding Cake", sizes: { "Standard": 150000 }, description: "6inch + 8inch + 10inch. Vanilla + Red Velvet. Buttercream", category: "Cakes" },
      { id: "demo-c6", name: "Cupcakes", sizes: { "Pack of 6": 8000, "Pack of 12": 15000 }, description: "Vanilla or Chocolate. Includes frosting", category: "Cakes" },
      { id: "demo-c7", name: "Cake Parfait", sizes: { "1 Cup": 2500 }, description: "Layers of cake, cream, and toppings in a cup", category: "Desserts" },
    ];
    // Persist seeds so they survive refresh
    localStorage.setItem(CATALOGUE_KEY, JSON.stringify(seeds));
    return seeds;
  } catch {
    return [];
  }
}

function shareToWhatsApp(item: CatalogueItem, size: string) {
  const price = item.sizes[size];
  const safePrice = price ?? 0;
  const text = `Hi, I want to order: ${item.name} - ${size} - NGN ${safePrice.toLocaleString()}. Date needed: `;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

function copyShareText(item: CatalogueItem, size: string): string {
  const price = item.sizes[size];
  const safePrice = price ?? 0;
  return `Hi, I want to order: ${item.name} - ${size} - NGN ${safePrice.toLocaleString()}. Date needed: `;
}

function getTodayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function getTomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning Baker!";
  if (h < 17) return "Good Afternoon Baker!";
  return "Good Evening Baker!";
}

function formatDateDisplay(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getWeekRange(): { start: string; end: string } {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday.toISOString().split("T")[0],
    end: sunday.toISOString().split("T")[0],
  };
}

/* ===================================================================
   AI Price Engine
   =================================================================== */

function suggestPrice(cake: string): number {
  const lower = cake.toLowerCase();
  const sizeMap: [string, number][] = [
    ["5kg", 55000], ["4kg", 45000], ["3kg", 35000], ["2kg", 20000],
    ["1.5kg", 17000], ["1kg", 10000], ["0.5kg", 6000],
    ["large", 25000], ["xl", 30000], ["big", 25000],
    ["medium", 15000], ["small", 8000], ["mini", 6000],
  ];
  let sizePrice = 15000;
  for (const [kw, p] of sizeMap) {
    if (lower.includes(kw)) { sizePrice = p; break; }
  }

  const typePremiums: [string, number][] = [
    ["wedding", 15000], ["birthday", 5000],
    ["red velvet", 5000], ["redvelvet", 5000],
    ["fondant", 10000], ["tier", 10000], ["custom", 7000],
    ["chocolate", 3000], ["black forest", 4000], ["fruit", 2000],
    ["vegan", 5000], ["gluten free", 6000], ["sugar free", 4000],
    ["buttercream", 1500], ["cream cheese", 2500],
  ];
  let premium = 0;
  for (const [kw, p] of typePremiums) {
    if (lower.includes(kw)) premium = Math.max(premium, p);
  }

  const complexityWords = ["layered", "filled", "decorated", "personalized", "photo", "sculpted", "drip", "ombre"];
  let complexity = 0;
  for (const w of complexityWords) {
    if (lower.includes(w)) complexity += 2000;
  }

  return sizePrice + premium + complexity;
}

/* ===================================================================
   Order Recipe Card
   =================================================================== */

function RecipeCard({ order, onToggleDone, onDelete }: {
  order: Order;
  onToggleDone: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const today = getTodayISO();
  const isDueToday = order.date === today && !order.done;
  const isOverdue = order.date < today && !order.done;
  const isDone = order.done;

  const borderAccent = isDueToday ? "border-pink-cake"
    : isOverdue ? "border-due-red"
    : isDone ? "border-done-green"
    : "border-brown-warm";

  const statusBadge = isDueToday
    ? { icon: "🔥", label: "Due Today", cls: "text-pink-cake bg-pink-cake-bg" }
    : isOverdue
      ? { icon: "⚠️", label: "Overdue", cls: "text-due-red bg-due-red-bg" }
      : isDone
        ? { icon: "✅", label: "Done", cls: "text-done-green bg-done-green-bg" }
        : { icon: "📅", label: "Upcoming", cls: "text-brown-warm bg-elevated" };

  return (
    <div
      className={`min-w-[230px] sm:min-w-[260px] bg-card rounded-2xl p-4 border-l-[5px] ${borderAccent} shadow-sm shrink-0`}
    >
      {/* Cake emoji placeholder */}
      <div className="text-3xl mb-2">🎂</div>

      {/* Customer + badge */}
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-text-primary font-heading text-base">{order.customer}</p>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusBadge.cls}`}>
          {statusBadge.icon} {statusBadge.label}
        </span>
      </div>

      {/* Cake type */}
      <p className="text-text-muted text-xs font-sans truncate">{order.cake}</p>

      {/* Date + Price row */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border-soft">
        <span className="flex items-center gap-1 text-text-muted text-[11px]">
          <span>⏰</span>
          <span>{formatDateDisplay(order.date)}</span>
        </span>
        <span className="text-gold font-bold text-sm">₦{order.price.toLocaleString()}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => onToggleDone(order.id)}
          className={`flex-1 text-xs font-semibold py-1.5 rounded-xl transition-all duration-150 active:scale-[0.97] cursor-pointer ${
            isDone
              ? "bg-elevated text-text-muted hover:bg-border-soft"
              : "bg-done-green-bg text-done-green hover:brightness-105"
          }`}
        >
          {isDone ? "↩ Undo" : "✅ Mark Done"}
        </button>
        <button
          onClick={() => onDelete(order.id)}
          className="text-xs px-2.5 py-1.5 rounded-xl text-due-red/50 hover:bg-due-red-bg hover:text-due-red transition-all duration-150 active:scale-[0.97] cursor-pointer"
        >
          🗑️
        </button>
      </div>
    </div>
  );
}

/* ===================================================================
   Add Order Modal
   =================================================================== */

function AddOrderModal({ onClose, onAdd, initialPrice, initialDescription }: {
  onClose: () => void;
  onAdd: (o: Order) => void;
  initialPrice?: number | null;
  initialDescription?: string | null;
}) {
  const [customer, setCustomer] = useState("");
  const [cake, setCake] = useState(initialDescription ?? "");
  const [date, setDate] = useState("");
  const [price, setPrice] = useState(initialPrice ? String(initialPrice) : "");
  const [aiSuggestion, setAiSuggestion] = useState<number | null>(null);
  const [isPriceLoading, setIsPriceLoading] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const generateId = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

  const handleSubmit = () => {
    if (!customer.trim() || !cake.trim()) {
      alert("Please enter customer name and cake type.");
      return;
    }
    onAdd({
      id: generateId(),
      customer: customer.trim(),
      cake: cake.trim(),
      date: date || getTodayISO(),
      price: Number(price) || 0,
      done: false,
    });
  };

  const handleAiSuggest = () => {
    if (!cake.trim()) { alert("Enter a cake type first!"); return; }
    setIsPriceLoading(true);
    setTimeout(() => {
      const s = suggestPrice(cake);
      setAiSuggestion(s);
      setPrice(String(s));
      setIsPriceLoading(false);
    }, 400);
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="w-full sm:max-w-md bg-bg-cream rounded-t-3xl sm:rounded-3xl p-6 pb-10 animate-in-up">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-text-primary font-heading text-lg">New Order 🎂</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-card flex items-center justify-center text-text-muted hover:text-text-primary transition-colors cursor-pointer border border-border-soft"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3.5">
          {/* Customer */}
          <div className="flex items-center gap-3 bg-card rounded-xl px-4 py-3 border border-border-soft focus-within:border-brown-warm/60 transition-all">
            <span className="text-lg">👤</span>
            <input
              type="text" value={customer} onChange={(e) => setCustomer(e.target.value)}
              placeholder="Customer name"
              className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted/50 focus:outline-none text-sm font-sans"
            />
          </div>

          {/* Cake type */}
          <div className="flex items-center gap-3 bg-card rounded-xl px-4 py-3 border border-border-soft focus-within:border-brown-warm/60 transition-all">
            <span className="text-lg">🧁</span>
            <input
              type="text" value={cake} onChange={(e) => setCake(e.target.value)}
              placeholder="Cake type + size (e.g. 3kg birthday)"
              className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted/50 focus:outline-none text-sm font-sans"
            />
            <button
              onClick={handleAiSuggest} disabled={isPriceLoading}
              className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-elevated text-brown-warm hover:bg-border-soft transition-all duration-150 active:scale-[0.97] cursor-pointer disabled:opacity-50 border border-border-soft"
            >
              {isPriceLoading ? (
                <span className="inline-block w-3 h-3 border-2 border-brown-warm/30 border-t-brown-warm rounded-full animate-spin" />
              ) : (
                <span>✨</span>
              )}
              <span>{isPriceLoading ? "..." : "AI"}</span>
            </button>
          </div>

          {/* Date + Price */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-3 bg-card rounded-xl px-4 py-3 border border-border-soft focus-within:border-brown-warm/60 transition-all">
              <span className="text-lg">📅</span>
              <input
                type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="flex-1 bg-transparent text-text-primary focus:outline-none text-sm font-sans"
              />
            </div>
            <div className="flex items-center gap-3 bg-card rounded-xl px-4 py-3 border border-border-soft focus-within:border-brown-warm/60 transition-all">
              <span className="text-lg">💰</span>
              <input
                type="number" value={price} onChange={(e) => setPrice(e.target.value)}
                placeholder="Price" step="100"
                className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted/50 focus:outline-none text-sm font-sans"
              />
            </div>
          </div>

          {/* AI Suggestion */}
          {aiSuggestion !== null && (
            <div className="flex items-center gap-2 text-xs text-gold bg-gold-light/50 rounded-xl px-4 py-2.5 border border-gold/20">
              <span>✨</span>
              <span>AI suggests <strong className="text-gold">₦{aiSuggestion.toLocaleString()}</strong></span>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            className="w-full bg-gold text-chocolate font-bold py-3.5 rounded-2xl hover:shadow-lg hover:brightness-105 active:scale-[0.97] transition-all duration-150 cursor-pointer text-sm tracking-wide border border-gold/30"
          >
            🎂 + Add Cake Order
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===================================================================
   Orders List Screen
   =================================================================== */

function OrdersListScreen({ orders, onToggleDone, onDelete, onBack }: {
  orders: Order[];
  onToggleDone: (id: string) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"pending" | "newest" | "price">("pending");

  const filtered = useMemo(() => {
    let list = [...orders];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((o) =>
        o.customer.toLowerCase().includes(q) || o.cake.toLowerCase().includes(q)
      );
    }
    if (sortKey === "pending") {
      list.sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
    } else if (sortKey === "newest") {
      list.sort((a, b) => (a.id > b.id ? -1 : 1));
    } else if (sortKey === "price") {
      list.sort((a, b) => b.price - a.price);
    }
    return list;
  }, [orders, search, sortKey]);

  return (
    <div className="px-4 pt-6 pb-32">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-xl bg-card flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors cursor-pointer border border-border-soft"
        >
          ←
        </button>
        <h2 className="text-text-primary font-heading text-lg">Orders 📋</h2>
        <span className="text-text-muted text-xs ml-auto">{orders.length} total</span>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 bg-card rounded-xl px-4 py-2.5 border border-border-soft focus-within:border-brown-warm/60 transition-all mb-4">
        <span className="text-sm text-text-muted">🔍</span>
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search orders…"
          className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted/50 focus:outline-none text-sm font-sans"
        />
      </div>

      {/* Sort */}
      <div className="flex items-center gap-2 mb-4">
        {(["pending", "newest", "price"] as const).map((k) => (
          <button
            key={k} onClick={() => setSortKey(k)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
              sortKey === k
                ? "bg-brown-warm text-white"
                : "bg-card text-text-muted hover:text-text-secondary border border-border-soft"
            }`}
          >
            {k === "pending" ? "📋 Pending" : k === "newest" ? "🕐 Newest" : "💰 Price ↓"}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 bg-card rounded-2xl border border-dashed border-border-soft">
          <div className="text-4xl mb-3">🧁</div>
          <p className="text-text-muted text-sm font-sans">
            {search ? "No orders match your search" : "No orders yet — bake something! 🎂"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((order) => {
            const today = getTodayISO();
            const isDue = order.date === today && !order.done;
            const isOverdue = order.date < today && !order.done;
            const isDone = order.done;

            const borderAccent = isDue ? "border-pink-cake"
              : isOverdue ? "border-due-red"
              : isDone ? "border-done-green"
              : "border-border-soft";

            return (
              <div
                key={order.id}
                className={`bg-card rounded-2xl p-4 border-l-[5px] ${borderAccent} shadow-sm`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-heading text-base text-text-primary">{order.customer}</span>
                      {isDue && <span className="text-[10px] font-bold text-pink-cake bg-pink-cake-bg px-2 py-0.5 rounded-full">🔥 Due</span>}
                      {isOverdue && <span className="text-[10px] font-bold text-due-red bg-due-red-bg px-2 py-0.5 rounded-full">⚠️ Late</span>}
                    </div>
                    <p className="text-text-muted text-xs font-sans mt-0.5 truncate">{order.cake}</p>
                    <p className="text-text-muted/50 text-[11px] mt-1 flex items-center gap-1">
                      <span>⏰</span> {formatDateDisplay(order.date)}
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-gold font-bold text-sm">₦{order.price.toLocaleString()}</p>
                    <div className="flex items-center gap-1 mt-2 justify-end">
                      <button
                        onClick={() => onToggleDone(order.id)}
                        className={`text-xs px-2 py-1 rounded-lg transition-all cursor-pointer ${
                          isDone
                            ? "bg-elevated text-text-muted"
                            : "bg-done-green-bg text-done-green"
                        }`}
                      >
                        {isDone ? "↩" : "✅"}
                      </button>
                      <button
                        onClick={() => onDelete(order.id)}
                        className="text-xs px-2 py-1 rounded-lg text-due-red/50 hover:bg-due-red-bg hover:text-due-red transition-all cursor-pointer"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ===================================================================
   AI Tools Screen
   =================================================================== */

function AiToolsScreen({ onBack }: { onBack: () => void }) {
  const [cakeInput, setCakeInput] = useState("");
  const [suggestedPrice, setSuggestedPrice] = useState<number | null>(null);

  const handleSuggest = () => {
    if (!cakeInput.trim()) return;
    setSuggestedPrice(suggestPrice(cakeInput));
  };

  return (
    <div className="px-4 pt-6 pb-32">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-xl bg-card flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors cursor-pointer border border-border-soft"
        >
          ←
        </button>
        <h2 className="text-text-primary font-heading text-lg">AI Tools 💡</h2>
      </div>

      {/* Price Calculator Card */}
      <div className="bg-card rounded-2xl p-5 border border-border-soft shadow-sm mb-4">
        <h3 className="text-text-primary font-heading text-base mb-1">🧁 AI Price Calculator</h3>
        <p className="text-text-muted text-xs font-sans mb-4">
          Type your cake details, tap ✨ and get a price!
        </p>

        <div className="flex items-center gap-3 bg-bg-cream rounded-xl px-4 py-3 border border-border-soft focus-within:border-brown-warm/60 transition-all mb-3">
          <span className="text-lg">🎂</span>
          <input
            type="text" value={cakeInput} onChange={(e) => setCakeInput(e.target.value)}
            placeholder="e.g. 3kg red velvet layered"
            className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted/50 focus:outline-none text-sm font-sans"
          />
        </div>

        <button
          onClick={handleSuggest}
          className="w-full bg-chocolate text-bg-cream font-bold py-3 rounded-2xl hover:shadow-md active:scale-[0.97] transition-all duration-150 cursor-pointer text-sm flex items-center justify-center gap-2"
        >
          <span>✨</span>
          <span>Suggest Price</span>
        </button>

        {suggestedPrice !== null && (
          <div className="mt-4 flex items-center justify-center gap-2 bg-gold-light/50 rounded-xl px-4 py-3 border border-gold/20">
            <span className="text-lg">💰</span>
            <span className="text-text-primary font-heading text-lg">
              ₦{suggestedPrice.toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {/* Quick Reference */}
      <div className="bg-card rounded-2xl p-5 border border-border-soft shadow-sm">
        <h3 className="text-text-primary font-heading text-base mb-3">📋 Price Guide</h3>
        <div className="space-y-2 text-xs font-sans">
          {[
            ["Small (0.5–1kg)", "₦25,000 – ₦35,000"],
            ["Medium (1.5–2kg)", "₦40,000 – ₦60,000"],
            ["Large (3–4kg)", "₦70,000 – ₦100,000"],
            ["XL (5kg+)", "₦120,000+"],
          ].map(([item, range]) => (
            <div key={item} className="flex items-center justify-between py-1.5 border-b border-border-soft/50 last:border-0">
              <span className="text-text-secondary">{item}</span>
              <span className="text-gold font-bold">{range}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 pt-3 border-t border-border-soft/50">
          <p className="text-text-muted text-[11px] font-sans mb-2 font-medium">Premiums</p>
          <div className="space-y-2 text-xs font-sans">
            {[
              ["Wedding cake", "+₦50,000"],
              ["Fondant / Tiered", "+₦30,000"],
              ["Red Velvet", "+₦15,000"],
              ["Fruit Cake", "+₦25,000"],
              ["Layered / Filled", "+₦10,000 per extra layer"],
              ["Custom Design", "+₦20,000"],
            ].map(([item, p]) => (
              <div key={item} className="flex items-center justify-between py-1 border-b border-border-soft/30 last:border-0">
                <span className="text-text-secondary">{item}</span>
                <span className="text-gold font-bold">{p}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-text-muted/50 text-[10px] font-sans mt-3 text-center italic">Prices vary by location and ingredients</p>
      </div>
    </div>
  );
}

/* ===================================================================
   CSV Export Utility
   =================================================================== */

function exportOrdersToCSV(orders: Order[]) {
  if (orders.length === 0) {
    alert("No orders to export.");
    return;
  }

  const headers = ["Customer", "Cake", "Due Date", "Price (₦)", "Status"];
  const rows = orders.map((o) => [
    `"${o.customer.replace(/"/g, '""')}"`,
    `"${o.cake.replace(/"/g, '""')}"`,
    o.date,
    o.price,
    o.done ? "Completed" : "Pending",
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bakertasks-orders-${getTodayISO()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ===================================================================
   Add Catalogue Work Modal
   =================================================================== */

function AddCatalogueWorkModal({ onClose, onSave, editItem, onDelete }: {
  onClose: () => void;
  onSave: (item: CatalogueItem) => void;
  editItem?: CatalogueItem;
  onDelete?: (id: string) => void;
}) {
  const [name, setName] = useState(editItem?.name ?? "");
  const [description, setDescription] = useState(editItem?.description ?? "");
  const [sizeLabel, setSizeLabel] = useState("");
  const [sizePrice, setSizePrice] = useState("");
  const [sizes, setSizes] = useState<Record<string, number>>(editItem?.sizes ?? {});
  const [category, setCategory] = useState(editItem?.category ?? "");
  const [photo, setPhoto] = useState(editItem?.photo ?? "");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert("Image is too large. Please choose one under 5MB.");
        e.target.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => setPhoto(ev.target?.result as string);
      reader.onerror = () => {
        alert("Couldn't read that image — try a different one?");
        e.target.value = "";
      };
      reader.readAsDataURL(file);
    }
  };

  const addSize = () => {
    if (!sizeLabel.trim() || !sizePrice.trim()) return;
    setSizes((p) => ({ ...p, [sizeLabel.trim()]: Number(sizePrice) }));
    setSizeLabel("");
    setSizePrice("");
  };

  const removeSize = (key: string) => {
    setSizes((p) => {
      const copy = { ...p };
      delete copy[key];
      return copy;
    });
  };

  const handleSave = () => {
    if (!name.trim() || Object.keys(sizes).length === 0) {
      alert("Cake name and at least one size are required!");
      return;
    }
    onSave({
      id: editItem?.id ?? crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
      name: name.trim(),
      sizes,
      category: category.trim(),
      description: description.trim(),
      photo: photo || undefined,
    });
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="w-full sm:max-w-md bg-bg-cream rounded-t-3xl sm:rounded-3xl p-6 pb-8 animate-in-up max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-text-primary font-heading text-lg">📸 Add to Catalogue</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-card flex items-center justify-center text-text-muted hover:text-text-primary transition-colors cursor-pointer border border-border-soft"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3.5">
          {/* PHOTO */}
          <div>
            {photo ? (
              <div className="w-full">
                <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-card border border-border-soft">
                  <img src={photo} alt="Cake preview" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setPhoto("")}
                    className="absolute top-2 right-2 w-7 h-7 bg-black/50 text-white rounded-full flex items-center justify-center text-xs cursor-pointer hover:bg-black/70 transition-all"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex items-center justify-center gap-2 mt-2">
                  <button
                    onClick={() => galleryRef.current?.click()}
                    className="text-[11px] font-semibold text-gold hover:text-chocolate bg-gold-light/40 hover:bg-gold-light/70 px-3 py-1.5 rounded-lg transition-all duration-150 cursor-pointer border border-gold/30"
                  >
                    🖼️ Change Photo
                  </button>
                  <button
                    onClick={() => cameraRef.current?.click()}
                    className="text-[11px] font-semibold text-gold hover:text-chocolate bg-gold-light/40 hover:bg-gold-light/70 px-3 py-1.5 rounded-lg transition-all duration-150 cursor-pointer border border-gold/30"
                  >
                    📸 Retake
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full aspect-video rounded-xl border-2 border-dashed border-gold/40 bg-card flex flex-col items-center justify-center gap-2.5 transition-all duration-150">
                <span className="text-3xl">📷</span>
                <span className="text-text-muted text-xs font-sans font-medium">Add a photo of your cake</span>
                <div className="flex items-center gap-2.5">
                  {/* Choose from Gallery */}
                  <button
                    onClick={() => galleryRef.current?.click()}
                    className="flex items-center gap-1.5 text-[11px] font-semibold px-4 py-2 rounded-xl bg-white text-text-primary hover:bg-gold hover:text-chocolate hover:shadow-sm active:scale-[0.97] transition-all duration-150 cursor-pointer border border-gold/30"
                  >
                    🖼️ Gallery
                  </button>
                  {/* Take Photo */}
                  <button
                    onClick={() => cameraRef.current?.click()}
                    className="flex items-center gap-1.5 text-[11px] font-semibold px-4 py-2 rounded-xl bg-white text-text-primary hover:bg-gold hover:text-chocolate hover:shadow-sm active:scale-[0.97] transition-all duration-150 cursor-pointer border border-gold/30"
                  >
                    📸 Camera
                  </button>
                </div>
                <span className="text-text-muted/40 text-[9px] font-sans">Upload AI-generated or real cake photos</span>
                <input ref={galleryRef} type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoUpload} className="hidden" />
              </div>
            )}
          </div>

          {/* Cake name */}
          <div className="flex items-center gap-3 bg-card rounded-xl px-4 py-3 border border-border-soft focus-within:border-brown-warm/60 transition-all">
            <span className="text-lg">🧁</span>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="E.g: 3-Tier Red Velvet Wedding"
              className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted/50 focus:outline-none text-sm font-sans"
            />
          </div>

          {/* Description */}
          <div className="flex items-start gap-3 bg-card rounded-xl px-4 py-3 border border-border-soft focus-within:border-brown-warm/60 transition-all">
            <span className="text-lg mt-0.5">📝</span>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="E.g: Vanilla + Chocolate layers, Fondant finish"
              rows={2}
              className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted/50 focus:outline-none text-sm font-sans resize-none"
            />
          </div>

          {/* Category — single text input */}
          <div>
            <p className="text-text-muted text-[11px] font-sans mb-2">Category:</p>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Birthday, Wedding, Custom"
              className="w-full bg-transparent text-text-primary placeholder:text-text-muted/50 focus:outline-none text-sm font-sans pb-1 border-b border-gold/30 focus:border-gold transition-colors duration-150"
            />
          </div>

          {/* Sizes & Prices */}
          <div>
            <p className="text-text-muted text-[11px] font-sans mb-2">Sizes &amp; Prices <span className="text-gold">*</span></p>

            {/* Suggested size quick-tap buttons — auto-fill name + price */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(["6 inch","8 inch","10 inch","12 inch","14 inch","2 Tier","3 Tier","Cupcakes"] as const).map((s) => {
                const priceGuide: Record<string, number> = {
                  "6 inch": 12000, "8 inch": 15500, "10 inch": 20000,
                  "12 inch": 30000, "14 inch": 45000,
                  "2 Tier": 60000, "3 Tier": 150000, "Cupcakes": 15000,
                };
                return (
                  <button
                    key={s}
                    onClick={() => {
                      setSizeLabel(s);
                      setSizePrice(String(priceGuide[s]));
                      setTimeout(() => document.getElementById("size-price-input")?.focus(), 50);
                    }}
                    className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all duration-150 cursor-pointer active:scale-[0.95] ${
                      sizeLabel === s
                        ? "bg-gold text-chocolate border-gold/60 shadow-sm"
                        : "bg-card text-text-muted hover:text-text-secondary border-border-soft hover:border-gold/40"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>

            {/* Added sizes list — scrollable */}
            {Object.keys(sizes).length > 0 && (
              <div className="max-h-36 overflow-y-auto space-y-1.5 mb-3 pr-1">
                {Object.entries(sizes).map(([label, price]) => (
                  <div key={label} className="flex items-center gap-2 bg-card rounded-xl px-3 py-2 border border-border-soft">
                    <span className="text-sm font-semibold text-text-primary flex-1 truncate">{label} — ₦{price.toLocaleString()}</span>
                    <button
                      onClick={() => removeSize(label)}
                      className="w-6 h-6 flex items-center justify-center text-xs text-red-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all duration-150 cursor-pointer active:scale-[0.9] shrink-0"
                      aria-label={`Remove ${label}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add size inputs */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={sizeLabel}
                onChange={(e) => setSizeLabel(e.target.value)}
                placeholder="Size name — e.g. 6 inch"
                className="flex-1 min-w-0 bg-card text-text-primary placeholder:text-text-muted/50 focus:outline-none text-sm font-sans px-3 py-2 rounded-xl border border-border-soft focus:border-brown-warm/60 transition-all"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("size-price-input")?.focus(); } }}
              />
              <input
                id="size-price-input"
                type="number"
                value={sizePrice}
                onChange={(e) => setSizePrice(e.target.value)}
                placeholder="Price"
                className="w-24 min-w-0 bg-card text-text-primary placeholder:text-text-muted/50 focus:outline-none text-sm font-sans px-3 py-2 rounded-xl border border-border-soft focus:border-brown-warm/60 transition-all"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSize(); } }}
              />
              <button
                onClick={addSize}
                disabled={!sizeLabel.trim() || !sizePrice.trim()}
                className="flex items-center gap-1 text-[11px] font-semibold px-3 py-2 rounded-xl bg-gold text-chocolate hover:shadow-sm active:scale-[0.97] transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border border-gold/30 whitespace-nowrap shrink-0"
              >
                + Add
              </button>
            </div>

            {Object.keys(sizes).length === 0 && (
              <p className="text-red-400/70 text-[10px] font-sans mt-1.5">Add at least one size &amp; price</p>
            )}
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            className="w-full bg-gold text-chocolate font-bold py-3.5 rounded-2xl hover:shadow-lg hover:brightness-105 active:scale-[0.97] transition-all duration-150 cursor-pointer text-sm tracking-wide border border-gold/30"
          >
            {editItem ? "💾 Save Changes" : "🖼️ Save to Catalogue"}
          </button>

          {/* Delete button (edit mode only) */}
          {editItem && (
            <>
              {showDeleteConfirm ? (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-text-muted">Delete this cake?</span>
                  <button
                    onClick={() => { onDelete?.(editItem.id); onClose(); }}
                    className="flex-1 text-xs font-bold py-2 px-3 rounded-xl bg-due-red text-white hover:brightness-110 active:scale-[0.97] transition-all duration-150 cursor-pointer"
                  >
                    Yes, Delete
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="text-xs font-semibold py-2 px-3 rounded-xl bg-card border border-border-soft text-text-muted hover:text-text-primary active:scale-[0.97] transition-all duration-150 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full mt-3 text-xs font-semibold py-2.5 rounded-xl border border-due-red/20 bg-due-red/5 text-due-red hover:bg-due-red/10 active:scale-[0.97] transition-all duration-150 cursor-pointer"
                >
                  🗑️ Delete Cake
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===================================================================
   Helpers
   =================================================================== */

/* Safely get the minimum size price from an item's sizes record.
   Returns 0 if sizes is empty or undefined. */
function safeMinSize(item: CatalogueItem): number {
  const values = Object.values(item.sizes);
  if (values.length === 0) return 0;
  const min = Math.min(...values);
  return Number.isFinite(min) ? min : 0;
}

/* ===================================================================
   Catalogue Screen
   =================================================================== */

function CatalogueScreen({ onBack, items, onSave, onDelete }: {
  onBack: () => void;
  items: CatalogueItem[];
  onSave: (item: CatalogueItem) => void;
  onDelete: (id: string) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<CatalogueItem | null>(null);
  const [shareToast, setShareToast] = useState<string | null>(null);

  // SAFE VERSION: Guard against undefined/NaN in sizes
  const safeMinSize = (item: CatalogueItem): number => {
    try {
      const values = Object.values(item.sizes ?? {});
      if (values.length === 0) return 0;
      return Math.min(...values);
    } catch {
      return 0;
    }
  };

  return (
    <div className="px-4 pt-6 pb-32">
      {/* Share toast */}
      {shareToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] animate-toast-in">
          <div className="bg-chocolate text-bg-cream font-sans text-sm font-semibold px-5 py-3 rounded-2xl shadow-lg border border-white/10 flex items-center gap-2">
            <span>📋</span>
            {shareToast}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl bg-card flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors cursor-pointer border border-border-soft"
          >
            ←
          </button>
          <h2 className="text-text-primary font-heading text-lg">My Cake Catalogue 🖼️</h2>
        </div>
        <button
          onClick={() => { setEditItem(null); setShowAdd(true); }}
          className="bg-gold text-chocolate font-bold text-xs px-3 py-2 rounded-xl hover:shadow-md active:scale-[0.97] transition-all duration-150 cursor-pointer border border-gold/30"
        >
          + Add Work
        </button>
      </div>

      {items.length === 0 ? (
        /* Empty state */
        <div className="text-center py-20 bg-card rounded-2xl border border-dashed border-border-soft shadow-sm">
          <div className="text-5xl mb-4">🖼️</div>
          <p className="text-text-muted text-sm font-heading font-semibold mb-1">Showcase your cakes</p>
          <p className="text-text-muted/40 text-[11px] font-sans">Customers book from what they see</p>
        </div>
      ) : (
        /* 2-column grid */
        <div className="grid grid-cols-2 gap-3">
          {items.map((item) => (
            <div key={item.id} className="bg-card rounded-2xl overflow-hidden border border-border-soft shadow-sm">
              {/* Cake photo */}
              <div className="aspect-square bg-elevated flex items-center justify-center overflow-hidden">
                {item.photo ? (
                  <img src={item.photo} alt={item.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-5xl">🎂</span>
                )}
              </div>

              {/* Info */}
              <div className="p-3">
                <p className="font-heading text-sm text-text-primary truncate">{item.name}</p>
                <p className="font-heading text-sm text-gold font-bold mt-0.5">
                  ₦{safeMinSize(item).toLocaleString()}+
                </p>

                {/* Category badge */}
                {item.category && (
                  <div className="mt-1.5">
                    <span className="text-[9px] font-semibold text-text-muted bg-elevated px-1.5 py-0.5 rounded-full border border-border-soft">
                      {item.category}
                    </span>
                  </div>
                )}

                {/* Edit + Share + Delete */}
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => { setEditItem(item); setShowAdd(true); }}
                    className="text-[10px] px-2 py-1.5 rounded-lg text-blue-600/60 hover:bg-blue-600/10 hover:text-blue-600 transition-all duration-150 cursor-pointer"
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={async () => {
                      const defaultSize = Object.keys(item.sizes)[0];
                      const text = copyShareText(item, defaultSize);
                      try {
                        await navigator.clipboard.writeText(text);
                      } catch {
                        // Silent fallback — clipboard not available
                      }
                      setShareToast("Copied!");
                      setTimeout(() => setShareToast(null), 2000);
                      shareToWhatsApp(item, defaultSize);
                    }}
                    className="flex-1 text-[10px] font-semibold py-1.5 rounded-lg bg-green-600/10 text-green-600 hover:bg-green-600/20 active:scale-[0.97] transition-all duration-150 cursor-pointer border border-green-600/20"
                  >
                    📱 Share
                  </button>
                  <button
                    onClick={() => onDelete(item.id)}
                    className="text-[10px] px-2 py-1.5 rounded-lg text-due-red/50 hover:bg-due-red-bg hover:text-due-red transition-all duration-150 cursor-pointer"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Work Modal */}
      {showAdd && (
        <AddCatalogueWorkModal
          editItem={editItem}
          onClose={() => { setEditItem(null); setShowAdd(false); }}
          onSave={(item) => { onSave(item); setEditItem(null); setShowAdd(false); }}
        />
      )}
    </div>
  );
}

/* ===================================================================
   AI Price Helper Modal (Popup)
   =================================================================== */

function AIPriceHelperModal({ onClose, onUsePrice }: {
  onClose: () => void;
  onUsePrice: (price: number, description: string) => void;
}) {
  const [description, setDescription] = useState("");
  const [ingredientCost, setIngredientCost] = useState("");
  const [isCalculating, setIsCalculating] = useState(false);
  const [prices, setPrices] = useState<PriceSuggestion[] | null>(null);
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [location, setLocation] = useState<"lagos" | "ogun">("lagos");
  const deliveryFee = location === "lagos" ? 15000 : 10000;
  const premiumExtra = location === "lagos" ? 20000 : 15000;
  const locationName = location === "lagos" ? "Lagos" : "Ogun";
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleCalculate = () => {
    if (!description.trim()) { alert("Please describe the cake first! 🎂"); return; }
    if (!ingredientCost.trim() || Number(ingredientCost) <= 0) { alert("Enter your ingredient cost! 💰"); return; }

    setIsCalculating(true);
    const cost = Number(ingredientCost);
    const isLagos = location === "lagos";

    // 👇 State-specific pricing formulas (Southwest Nigeria)
    const deliveryFee = isLagos ? 15000 : 10000;
    const premiumExtra = isLagos ? 20000 : 15000;
    const budgetMultiplier = isLagos ? 2.0 : 1.9;
    const standardMultiplier = isLagos ? 2.3 : 2.2;
    const premiumMultiplier = isLagos ? 2.5 : 2.4;

    const locationLabel = isLagos ? "Lagos Rate" : "Ogun Rate";
    const locationName = isLagos ? "Lagos" : "Ogun";

    // Simulate AI thinking delay
    setTimeout(() => {
      const suggestions: PriceSuggestion[] = [
        { tier: "budget", label: "💰 Budget Price", multiplier: budgetMultiplier, amount: Math.round(cost * budgetMultiplier / 100) * 100, badge: locationLabel },
        { tier: "standard", label: "⭐ Standard Price", multiplier: standardMultiplier, amount: Math.round((cost * standardMultiplier + deliveryFee) / 100) * 100, badge: `Most Popular — ${locationName}` },
        { tier: "premium", label: "👑 Premium Price", multiplier: premiumMultiplier, amount: Math.round((cost * premiumMultiplier + premiumExtra) / 100) * 100, badge: locationLabel },
      ];
      setPrices(suggestions);
      setSelectedTier(null);
      setIsCalculating(false);
    }, 600);
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="w-full sm:max-w-md bg-bg-cream rounded-t-3xl sm:rounded-3xl p-6 pb-8 animate-in-up max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-text-primary font-heading text-lg">AI Cake Price Calculator 🧁</h2>
            <p className="text-text-muted text-[11px] font-sans mt-0.5">Smart pricing for Southwest Nigeria 🇳🇬</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-card flex items-center justify-center text-text-muted hover:text-text-primary transition-colors cursor-pointer border border-border-soft shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Location toggle — Lagos / Ogun State */}
        <div className="flex gap-2 mb-4">
          {(["lagos", "ogun"] as const).map((loc) => (
            <button
              key={loc}
              onClick={() => { setLocation(loc); setPrices(null); }}
              className={`flex-1 text-xs font-bold py-2.5 rounded-xl transition-all duration-150 cursor-pointer border ${
                location === loc
                  ? "bg-chocolate text-bg-cream shadow-md border-chocolate"
                  : "bg-white text-text-muted hover:text-text-secondary border-gold/30 hover:border-gold/60"
              }`}
            >
              {loc === "lagos" ? "🏙️ Lagos State" : "🌳 Ogun State"}
            </button>
          ))}
        </div>

        <div className="space-y-3.5">
          {/* Cake description */}
          <div className="flex items-center gap-3 bg-card rounded-xl px-4 py-3 border border-border-soft focus-within:border-brown-warm/60 transition-all">
            <span className="text-lg">🎂</span>
            <input
              type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the cake — e.g. 3 tier chocolate cake for 50 people"
              className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted/50 focus:outline-none text-sm font-sans"
            />
          </div>

          {/* Autocomplete suggestion chips */}
          {(() => {
            const allSuggestions = [
              "3-Tier Wedding Cake", "2-Tier Wedding Cake", "Wedding Cupcakes",
              "7kg Birthday Cake", "5kg Birthday Cake", "Character Cake",
              "Fondant Cake", "Cupcakes 50pcs", "Cupcakes 100pcs",
              "Anniversary Cake", "Bridal Shower Cake", "Small Chops Platter",
            ];
            const q = description.toLowerCase().trim();
            if (!q) return null;
            const filtered = allSuggestions
              .filter((s) => s.toLowerCase().includes(q))
              .slice(0, 4);
            if (filtered.length === 0) return null;
            return (
              <div className="flex flex-wrap gap-2 -mt-1">
                {filtered.map((s) => (
                  <button
                    key={s}
                    onClick={() => setDescription(s)}
                    className="text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all duration-150 cursor-pointer bg-white text-text-secondary border border-gold hover:bg-gold hover:text-white active:scale-[0.96]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            );
          })()}

          {/* Ingredient cost */}
          <div className="flex items-center gap-3 bg-card rounded-xl px-4 py-3 border border-border-soft focus-within:border-brown-warm/60 transition-all">
            <span className="text-lg">💰</span>
            <input
              type="number" value={ingredientCost} onChange={(e) => setIngredientCost(e.target.value)}
              placeholder="Your cost of ingredients ₦ — e.g. 15000"
              className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted/50 focus:outline-none text-sm font-sans"
            />
          </div>

          {/* Calculate button */}
          <button
            onClick={handleCalculate} disabled={isCalculating}
            className="w-full bg-chocolate text-bg-cream font-bold py-3.5 rounded-2xl hover:shadow-md active:scale-[0.97] transition-all duration-150 cursor-pointer text-sm tracking-wide shadow-sm disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {isCalculating ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Thinking...</span>
              </>
            ) : (
              <>
                <span>✨</span>
                <span>Get AI Price Suggestion</span>
              </>
            )}
          </button>

          {/* Results */}
          {prices && (
            <div className="mt-2 animate-in-up">
              {/* Dynamic AI suggestion — reads description */}
              <div className="bg-card rounded-2xl p-4 border border-brown-warm/30 shadow-sm mb-3">
                <p className="text-text-muted text-xs font-sans leading-relaxed">
                  🤖 <strong>AI suggests ₦{prices.find(p => p.tier === "standard")!.amount.toLocaleString()} for "{description}" based on {locationName} pricing</strong>
                </p>
                <p className="text-text-muted/60 text-[10px] font-sans mt-1">
                  Ingredient cost ₦{Number(ingredientCost).toLocaleString()} × {prices.find(p => p.tier === "standard")!.multiplier} + delivery = <strong className="text-gold">₦{prices.find(p => p.tier === "standard")!.amount.toLocaleString()}</strong>
                </p>
              </div>

              {/* Price cards — tap to select */}
              <div className="space-y-2.5">
                {prices.map((p) => {
                  const isSelected = selectedTier === p.tier;
                  return (
                    <div
                      key={p.tier}
                      onClick={() => setSelectedTier(p.tier)}
                      className={`rounded-2xl p-4 border-2 transition-all duration-150 cursor-pointer active:scale-[0.98] ${
                        p.tier === "standard"
                          ? "border-gold bg-gold-light/30 shadow-sm"
                          : "border-brown-warm/30 bg-card"
                      } ${isSelected ? "ring-2 ring-gold/40" : ""}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-heading text-sm text-text-primary">{p.label}</span>
                        {p.badge && (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            p.tier === "standard"
                              ? "text-gold bg-gold-light/60 border border-gold/30"
                              : "text-text-muted bg-elevated"
                          }`}>
                            {p.badge}
                          </span>
                        )}
                      </div>
                      <div className="flex items-end justify-between">
                        <span className="text-xl font-heading font-bold text-chocolate">
                          ₦{p.amount.toLocaleString()}
                        </span>
                        <span className="text-[10px] text-text-muted font-sans">
                          {p.tier === "budget" ? "No delivery" : `+₦${p.tier === "standard" ? deliveryFee.toLocaleString() : premiumExtra.toLocaleString()} delivery`}
                        </span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); onUsePrice(p.amount, description); }}
                        className="mt-2 w-full text-xs font-semibold py-2 rounded-xl bg-chocolate/10 text-chocolate hover:bg-chocolate/20 active:scale-[0.97] transition-all duration-150 cursor-pointer border border-chocolate/20"
                      >
                        ✏️ Use This Price
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Note */}
              <p className="text-text-muted/40 text-[10px] text-center mt-3 font-sans">
                🤖 Pricing based on real 2026 Lagos & Ogun bakery data — updated regularly!
              </p>
            </div>
          )}

          {/* Initial state hint */}
          {prices === null && !isCalculating && (
            <div className="bg-card rounded-2xl p-4 border border-dashed border-border-soft text-center">
              <div className="text-3xl mb-2">🧁</div>
              <p className="text-text-muted text-xs font-sans">
                Tell us about your cake and your ingredient cost — we'll suggest the perfect price!
              </p>
              <p className="text-text-muted/40 text-[10px] mt-2 font-sans">
                Example: "3 tier red velvet with buttercream for 50 guests"
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===================================================================
   Main App
   =================================================================== */

export default function App() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAiPriceModal, setShowAiPriceModal] = useState(false);
  const [pendingAiPrice, setPendingAiPrice] = useState<number | null>(null);
  const [pendingAiDescription, setPendingAiDescription] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isToastExiting, setIsToastExiting] = useState(false);
  const [boardSearch, setBoardSearch] = useState("");
  const [boardFilter, setBoardFilter] = useState<"all" | "pending" | "completed" | "due">("all");
  const boardScrollRef = useRef<HTMLDivElement>(null);

  // Quick Price Calculator state
  const [calcSize, setCalcSize] = useState("1kg");
  const [calcType, setCalcType] = useState("Vanilla");
  const [calcAddons, setCalcAddons] = useState({
    fondant: false,
    flowers: false,
    delivery: false,
    customText: false,
    photoPrint: false,
    extraTier: false,
    sparklerCandles: false,
    cakeStandRental: false,
  });
  const [calcResult, setCalcResult] = useState<number | null>(null);
  const [calcModalOpen, setCalcModalOpen] = useState(false);

  useEffect(() => {
    setOrders(loadOrders());
    setCatalogue(loadCatalogue());
  }, []);
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(orders)); }, [orders]);
  useEffect(() => { localStorage.setItem(CATALOGUE_KEY, JSON.stringify(catalogue)); }, [catalogue]);

  const handleAddOrder = (order: Order) => {
    setOrders((p) => [order, ...p]);
    setShowAddModal(false);
    setPendingAiPrice(null);
    setPendingAiDescription(null);
  };

  const handleToggleDone = (id: string) =>
    setOrders((p) => p.map((o) => (o.id === id ? { ...o, done: !o.done } : o)));

  const handleDelete = (id: string) =>
    setOrders((p) => p.filter((o) => o.id !== id));

  const handleCalcAddToOrder = () => {
    if (calcResult === null) return;
    const addonLabels: string[] = [];
    if (calcAddons.fondant) addonLabels.push("Fondant");
    if (calcAddons.flowers) addonLabels.push("Flowers");
    if (calcAddons.delivery) addonLabels.push("Delivery");
    if (calcAddons.customText) addonLabels.push("Custom Text");
    if (calcAddons.photoPrint) addonLabels.push("Photo Print");
    if (calcAddons.extraTier) addonLabels.push("Extra Tier");
    if (calcAddons.sparklerCandles) addonLabels.push("Sparkler Candles");
    if (calcAddons.cakeStandRental) addonLabels.push("Cake Stand Rental");
    const addonStr = addonLabels.length > 0 ? ` + ${addonLabels.join(", ")}` : "";
    const newOrder: Order = {
      id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
      customer: "Quick Calc",
      cake: `${calcSize} ${calcType}${addonStr}`,
      date: getTodayISO(),
      price: calcResult,
      done: false,
    };
    setOrders((p) => [newOrder, ...p]);
    setCalcResult(null);
    setIsToastExiting(false);
    setToastMessage(`🧮 ₦${calcResult.toLocaleString()} added to Orders!`);
    setTimeout(() => {
      setIsToastExiting(true);
      setTimeout(() => { setToastMessage(null); setIsToastExiting(false); }, 350);
    }, 2200);
  };

  const handleUseAiPrice = (price: number, description: string) => {
    setPendingAiPrice(price);
    setPendingAiDescription(description);
    setShowAiPriceModal(false);
    setIsToastExiting(false);
    setToastMessage(`AI suggests ₦${price.toLocaleString()} for "${description}" — added to new order ✨`);
    setTimeout(() => {
      setIsToastExiting(true);
      setTimeout(() => { setToastMessage(null); setIsToastExiting(false); }, 350);
    }, 2200);
    setShowAddModal(true);
  };

  const handleAddCatalogue = (item: CatalogueItem) => {
    setCatalogue((p) => {
      const idx = p.findIndex((i) => i.id === item.id);
      if (idx !== -1) {
        // Edit mode: replace the item in-place
        const updated = [...p];
        updated[idx] = item;
        return updated;
      }
      // Add mode: prepend new item
      return [item, ...p];
    });
    setIsToastExiting(false);
    setToastMessage(`📸 "${item.name}" added to your catalogue!`);
    setTimeout(() => {
      setIsToastExiting(true);
      setTimeout(() => { setToastMessage(null); setIsToastExiting(false); }, 350);
    }, 2200);
  };

  const handleDeleteCatalogue = (id: string) => {
    setCatalogue((p) => p.filter((i) => i.id !== id));
    setIsToastExiting(false);
    setToastMessage("🗑️ Cake removed from catalogue");
    setTimeout(() => {
      setIsToastExiting(true);
      setTimeout(() => { setToastMessage(null); setIsToastExiting(false); }, 350);
    }, 2200);
  };

  // Stats
  const today = getTodayISO();
  const weekRange = getWeekRange();
  const todayOrders = orders.filter((o) => o.date === today);
  const weekOrders = orders.filter(
    (o) => o.date >= weekRange.start && o.date <= weekRange.end && !o.done
  );
  const weekEarnings = weekOrders.reduce((s, o) => s + o.price, 0);
  const pendingOrders = orders.filter((o) => !o.done);
  const dueTodayCount = orders.filter((o) => o.date === today && !o.done).length;

  // Orders for the activity board — supports search + filter chips
  const boardOrders = useMemo(
    () => {
      let list = [...orders].sort((a, b) => (a.id > b.id ? -1 : 1)).slice(0, 20);

      // Quick filter chips
      if (boardFilter === "pending") list = list.filter(o => !o.done);
      else if (boardFilter === "completed") list = list.filter(o => o.done);
      else if (boardFilter === "due") {
        const today = getTodayISO();
        const tomorrow = getTomorrowISO();
        list = list.filter(o => o.date === today || o.date === tomorrow);
      }

      // Search filter — matches name, cake, status, or price
      if (boardSearch.trim()) {
        const q = boardSearch.toLowerCase();
        list = list.filter(o =>
          o.customer.toLowerCase().includes(q) ||
          o.cake.toLowerCase().includes(q) ||
          o.price.toString().includes(q) ||
          (o.done ? "completed" : "pending").includes(q)
        );
      }

      return list;
    },
    [orders, boardSearch, boardFilter]
  );

  const showBottomNav = !showAddModal && !showAiPriceModal;

  /* =================================================================
     DASHBOARD VIEW
     ================================================================= */
  const renderDashboard = () => (
    <div>
      {/* ===== HEADER ===== */}
      <div className="bg-gradient-to-r from-[#4E342E] to-gold px-4 pt-6 pb-8 rounded-b-[2rem] shadow-[0_8px_32px_rgba(78,52,46,0.35)] relative overflow-hidden">
        {/* 3 floating white sparkles */}
        <span className="absolute top-4 left-[15%] w-2 h-2 bg-white/80 rounded-full animate-float-sparkle" />
        <span className="absolute top-8 right-[20%] w-1.5 h-1.5 bg-white/70 rounded-full animate-float-sparkle-2" />
        <span className="absolute top-12 left-[60%] w-2.5 h-2.5 bg-white/60 rounded-full animate-float-sparkle-3" />

        <div className="flex items-center justify-between mb-5 relative z-10">
          <div>
            <p className="text-gold text-[12px] font-sans font-bold uppercase tracking-[2px]">🧁 BakerTasks Pro</p>
            <h1 className="text-white font-heading text-[26px] mt-0.5 font-bold drop-shadow-[0_2px_8px_rgba(0,0,0,0.3)]">{getGreeting()} <span className="inline-block animate-cupcake-bounce text-xl">🧁</span></h1>
          </div>
          <div className="text-3xl w-12 h-12 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm border border-white/20">👩‍🍳</div>
        </div>

        {/* ===== STATS CARDS ===== */}
        <div className="grid grid-cols-2 gap-3">
          {/* Today's Orders */}
          <div className="bg-white rounded-[12px] p-4 shadow-[0_4px_12px_rgba(0,0,0,0.1)] border-l-[5px] border-l-gold hover:border-2 hover:border-gold transition-all duration-150">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 bg-gold rounded-full flex items-center justify-center">
                <span className="text-lg">🎂</span>
              </div>
              <span className="text-[10px] font-bold text-gold bg-gold-light/60 px-2.5 py-0.5 rounded-full font-sans border border-gold/20">Today</span>
            </div>
            <p className="text-[#3E2723] text-[36px] font-bold font-heading leading-none opacity-0 animate-count-reveal">{todayOrders.length}</p>
            <p className="text-[#6D4C41] text-sm font-sans mt-1 font-medium">Today's Orders</p>
            {dueTodayCount > 0 && (
              <p className="text-pink-cake text-[10px] font-bold font-sans mt-1 bg-pink-cake-bg px-2 py-0.5 rounded-full inline-block">
                🔥 {dueTodayCount} due today
              </p>
            )}
          </div>

          {/* Week's Earnings */}
          <div className="bg-white rounded-[12px] p-4 shadow-[0_4px_12px_rgba(0,0,0,0.1)] border-l-[5px] border-l-gold hover:border-2 hover:border-gold transition-all duration-150">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 bg-gold rounded-full flex items-center justify-center">
                <span className="text-lg">💰</span>
              </div>
              <span className="text-gold text-xs bg-gold-light/60 border border-gold/20 px-2 py-0.5 rounded-full">⭐</span>
            </div>
            <p className="text-[#3E2723] text-[36px] font-bold font-heading leading-none opacity-0 animate-count-reveal-2">₦{weekEarnings.toLocaleString()}</p>
            <p className="text-[#6D4C41] text-sm font-sans mt-1 font-medium">Week's Earnings</p>
          </div>
        </div>

        {/* ===== ACTION BUTTONS ===== */}
        <div className="grid grid-cols-2 gap-4 mt-5">
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-gold text-chocolate font-bold py-3.5 rounded-[6px] btn-shine-sweep active:scale-[0.97] transition-all duration-150 cursor-pointer text-sm tracking-wide shadow-[0_4px_8px_rgba(0,0,0,0.15)] border border-gold/30"
          >
            🎂 + New Cake Order
          </button>
          <button
            onClick={() => setShowAiPriceModal(true)}
            className="bg-white text-chocolate font-bold py-3.5 rounded-[6px] btn-pulse-glow active:scale-[0.97] transition-all duration-150 cursor-pointer text-sm tracking-wide border-2 border-gold relative overflow-hidden group shadow-[0_4px_8px_rgba(0,0,0,0.15)]"
          >
            <span className="group-hover:animate-pulse inline-block">✨</span> AI Price Help
            <span className="absolute -top-2 -right-1 bg-pink-cake text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full border border-white shadow-sm">
              AI
            </span>
          </button>
        </div>
      </div>

      {/* ===== ORDERS BOARD ===== */}
      <div className="px-4 mt-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-text-primary font-heading text-base">Orders Board 📋</h2>
          {pendingOrders.length > 0 && boardFilter === "all" && !boardSearch.trim() && (
            <span className="text-text-muted text-[11px] font-sans">{pendingOrders.length} pending</span>
          )}
        </div>

        {orders.length > 0 && (
          <>
            {/* Search bar — white bg, gold border on focus */}
            <div className="flex items-center gap-3 bg-white rounded-xl px-4 py-2.5 border border-border-soft focus-within:border-gold transition-all duration-150 shadow-sm mb-3">
              <span className="text-sm text-text-muted">🔍</span>
              <input
                type="text" value={boardSearch} onChange={(e) => setBoardSearch(e.target.value)}
                placeholder="Search by name, cake, status or price…"
                className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted/40 focus:outline-none text-sm font-sans"
              />
              {boardSearch && (
                <button
                  onClick={() => setBoardSearch("")}
                  className="text-text-muted/60 hover:text-text-primary text-xs cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Filter chips — gold active, white inactive */}
            <div className="flex gap-2 mb-3 overflow-x-auto scrollbar-none pb-1">
              {(["all", "pending", "completed", "due"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setBoardFilter(f)}
                  className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all duration-150 cursor-pointer border ${
                    boardFilter === f
                      ? "bg-gold text-white shadow-sm border-gold"
                      : "bg-white text-text-muted hover:text-text-secondary border-gold/30 hover:border-gold/60"
                  }`}
                >
                  {f === "all" ? "📋 All" : f === "pending" ? "⏳ Pending" : f === "completed" ? "✅ Completed" : "🔥 Due Today"}
                </button>
              ))}
            </div>
          </>
        )}

        {boardOrders.length === 0 ? (
          <div className="bg-card rounded-2xl p-8 text-center border border-dashed border-border-soft shadow-sm">
            <div className="text-4xl mb-2">🧁</div>
            <p className="text-text-muted text-xs font-medium font-sans mb-3">
              {boardSearch || boardFilter !== "all"
                ? "No orders match your search"
                : "No orders yet"}
            </p>
            <p className="text-text-muted/50 text-[10px] font-sans mb-3">
              {boardSearch || boardFilter !== "all"
                ? "Try adjusting your search or filters"
                : "Tap '+ New Cake Order' to add your first cake"}
            </p>
            {(boardSearch || boardFilter !== "all") && (
              <button
                onClick={() => { setBoardSearch(""); setBoardFilter("all"); }}
                className="text-xs font-semibold text-gold hover:text-chocolate bg-gold-light/50 hover:bg-gold-light px-4 py-2 rounded-xl transition-all duration-150 cursor-pointer border border-gold/20"
              >
                ✕ Clear filters
              </button>
            )}
          </div>
        ) : (
          <div
            ref={boardScrollRef}
            className="flex gap-3 overflow-x-auto pb-2 scrollbar-none -mx-4 px-4"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {boardOrders.map((order) => (
              <RecipeCard
                key={order.id}
                order={order}
                onToggleDone={handleToggleDone}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* ===== QUICK PRICE CALCULATOR ===== */}
      <div className="px-4 mt-6">
        <div className="bg-card rounded-2xl p-5 border border-border-soft shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-text-primary font-heading text-base">🧮 Quick Price Calculator</h3>
          </div>

          {/* Cake Size */}
          <div className="mb-3">
            <p className="text-text-muted text-[11px] font-sans mb-1.5 font-medium">Cake Size / Weight</p>
            <select
              value={calcSize}
              onChange={(e) => setCalcSize(e.target.value)}
              className="w-full bg-white rounded-xl px-4 py-2.5 text-sm text-text-primary border border-border-soft focus:border-gold focus:ring-1 focus:ring-gold/30 outline-none transition-all duration-150 cursor-pointer font-sans"
            >
              {["1kg", "2kg", "3kg", "5kg", "7kg", "10kg"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Cake Type */}
          <div className="mb-3">
            <p className="text-text-muted text-[11px] font-sans mb-1.5 font-medium">Cake Type</p>
            <select
              value={calcType}
              onChange={(e) => setCalcType(e.target.value)}
              className="w-full bg-white rounded-xl px-4 py-2.5 text-sm text-text-primary border border-border-soft focus:border-gold focus:ring-1 focus:ring-gold/30 outline-none transition-all duration-150 cursor-pointer font-sans"
            >
              {[
                { v: "Vanilla", label: "Vanilla +₦0" },
                { v: "Chocolate", label: "Chocolate +₦5,000" },
                { v: "Red Velvet", label: "Red Velvet +₦10,000" },
                { v: "Fruit Cake", label: "Fruit Cake +₦20,000" },
                { v: "Coconut", label: "Coconut +₦10,000" },
                { v: "Banana", label: "Banana +₦5,000" },
                { v: "Carrot", label: "Carrot +₦15,000" },
                { v: "Marble", label: "Marble +₦5,000" },
              ].map((t) => (
                <option key={t.v} value={t.v}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Add-ons */}
          <div className="mb-4">
            <p className="text-text-muted text-[11px] font-sans mb-1.5 font-medium">Add-ons</p>
            <button
              onClick={() => setCalcModalOpen(true)}
              className="w-full flex items-center justify-between bg-white rounded-xl px-4 py-2.5 border border-border-soft hover:border-gold/40 transition-all duration-150 cursor-pointer"
            >
              <span className="text-sm text-text-primary font-sans">Add Add-ons</span>
              <span className="text-xs text-gold font-semibold font-sans bg-gold-light/60 px-2 py-1 rounded-lg border border-gold/20">
                ({Object.values(calcAddons).filter(Boolean).length} selected)
              </span>
            </button>
          </div>

          {/* Add-ons Modal */}
          {calcModalOpen && (
            <div
              className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
              onClick={(e) => { if (e.target === e.currentTarget) setCalcModalOpen(false); }}
            >
              <div className="w-full sm:max-w-md bg-bg-cream rounded-t-3xl sm:rounded-3xl p-6 pb-8 animate-in-up max-h-[75vh]">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-text-primary font-heading text-lg">Select Add-ons</h2>
                  <button
                    onClick={() => setCalcModalOpen(false)}
                    className="w-8 h-8 rounded-xl bg-card flex items-center justify-center text-text-muted hover:text-text-primary transition-colors cursor-pointer border border-border-soft"
                  >
                    ✕
                  </button>
                </div>
                <div className="space-y-2 overflow-y-auto max-h-[50vh] pr-1">
                  {[
                    { key: "fondant" as const, label: "Fondant", price: 20000 },
                    { key: "flowers" as const, label: "Flowers", price: 15000 },
                    { key: "delivery" as const, label: "Delivery", price: 5000 },
                    { key: "customText" as const, label: "Custom Text", price: 5000 },
                    { key: "photoPrint" as const, label: "Photo Print", price: 10000 },
                    { key: "extraTier" as const, label: "Extra Tier", price: 50000 },
                    { key: "sparklerCandles" as const, label: "Sparkler Candles", price: 3000 },
                    { key: "cakeStandRental" as const, label: "Cake Stand Rental", price: 8000 },
                  ].map((a) => (
                    <label
                      key={a.key}
                      className="flex items-center gap-3 bg-white rounded-xl px-4 py-2.5 border border-border-soft hover:border-gold/40 transition-all duration-150 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={calcAddons[a.key]}
                        onChange={() =>
                          setCalcAddons((p) => ({ ...p, [a.key]: !p[a.key] }))
                        }
                        className="w-4 h-4 accent-gold rounded-md cursor-pointer"
                      />
                      <span className="flex-1 text-sm text-text-primary font-sans">{a.label}</span>
                      <span className="text-xs text-gold font-semibold font-sans">+₦{a.price.toLocaleString()}</span>
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-5">
                  <button
                    onClick={() => setCalcModalOpen(false)}
                    className="flex-1 text-sm font-semibold py-2.5 rounded-xl bg-card border border-border-soft text-text-muted hover:text-text-primary active:scale-[0.97] transition-all duration-150 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setCalcModalOpen(false)}
                    className="flex-1 text-sm font-bold py-2.5 rounded-xl bg-gold text-chocolate hover:shadow-md active:scale-[0.97] transition-all duration-150 cursor-pointer border border-gold/30"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Calculate Button */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                // Pricing formula
                const sizeKg = parseInt(calcSize);
                let base = 45000; // Base: 1kg Vanilla
                if (sizeKg > 1) base += (sizeKg - 1) * 10000; // +₦10,000 per extra kg
                const typePremium: Record<string, number> = {
                  "Vanilla": 0,
                  "Chocolate": 5000,
                  "Red Velvet": 10000,
                  "Fruit Cake": 20000,
                  "Coconut": 10000,
                  "Banana": 5000,
                  "Carrot": 15000,
                  "Marble": 5000,
                };
                base += typePremium[calcType] ?? 0;
                if (calcAddons.fondant) base += 20000;
                if (calcAddons.flowers) base += 15000;
                if (calcAddons.delivery) base += 5000;
                if (calcAddons.customText) base += 5000;
                if (calcAddons.photoPrint) base += 10000;
                if (calcAddons.extraTier) base += 50000;
                if (calcAddons.sparklerCandles) base += 3000;
                if (calcAddons.cakeStandRental) base += 8000;
                setCalcResult(base);
              }}
              className="flex-1 bg-gold text-chocolate font-bold py-3 rounded-2xl hover:shadow-md hover:brightness-105 active:scale-[0.97] transition-all duration-150 cursor-pointer text-sm border border-gold/30"
            >
              🧮 Calculate
            </button>
          </div>

          {/* Result */}
          {calcResult !== null && (
            <div className="mt-4 bg-white rounded-2xl p-4 border-2 border-gold/30 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-text-muted text-xs font-sans font-medium">Total Price</span>
                <span className="text-[10px] font-bold text-gold bg-gold-light/60 px-2 py-0.5 rounded-full border border-gold/20 font-sans">
                  {`${calcSize} ${calcType}`}
                </span>
              </div>
              <p className="text-chocolate text-[28px] font-bold font-heading leading-none">
                ₦{calcResult.toLocaleString()}
              </p>
              <p className="text-text-muted/50 text-[10px] font-sans mt-1">
                Base ₦45,000 for 1kg Vanilla + ₦10,000 per extra kg{calcType !== "Vanilla" ? ` + ${calcType} premium` : ""}{Object.entries(calcAddons).filter(([, v]) => v).length > 0 ? ` + ${Object.entries(calcAddons).filter(([, v]) => v).length} add-on(s)` : ""}
              </p>
              <button
                onClick={handleCalcAddToOrder}
                className="mt-3 w-full bg-chocolate text-bg-cream font-bold py-2.5 rounded-xl hover:shadow-md active:scale-[0.97] transition-all duration-150 cursor-pointer text-xs border border-chocolate/20 flex items-center justify-center gap-2"
              >
                <span>📋</span>
                <span>Add to Order</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ===== QUICK LINKS ===== */}
      <div className="px-4 mt-6">
        <p className="text-text-muted text-[10px] font-bold uppercase tracking-wider mb-3 font-sans">📌 Quick Links</p>
        <div className="grid grid-cols-3 gap-3">
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-card rounded-2xl p-4 flex flex-col items-center gap-2 border border-border-soft hover:border-brown-warm/40 hover:shadow-sm transition-all duration-150 active:scale-[0.97] cursor-pointer"
          >
            <span className="text-2xl">🎂</span>
            <span className="text-text-secondary text-xs font-sans font-medium">New Order</span>
          </button>
          <button
            onClick={() => setTab("orders")}
            className="bg-card rounded-2xl p-4 flex flex-col items-center gap-2 border border-border-soft hover:border-brown-warm/40 hover:shadow-sm transition-all duration-150 active:scale-[0.97] cursor-pointer"
          >
            <span className="text-2xl">📋</span>
            <span className="text-text-secondary text-xs font-sans font-medium">All Orders</span>
            {dueTodayCount > 0 && (
              <span className="text-[10px] font-bold text-pink-cake bg-pink-cake-bg px-2 py-0.5 rounded-full -mt-1 font-sans">
                🔥 {dueTodayCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowAiPriceModal(true)}
            className="bg-card rounded-2xl p-4 flex flex-col items-center gap-2 border border-border-soft hover:border-brown-warm/40 hover:shadow-sm transition-all duration-150 active:scale-[0.97] cursor-pointer"
          >
            <span className="text-2xl">✨</span>
            <span className="text-text-secondary text-xs font-sans font-medium">AI Price</span>
          </button>
        </div>
      </div>

      {/* ===== SPACER FOR BOTTOM NAV ===== */}
      <div className="h-24" />
    </div>
  );

  /* =================================================================
     RENDER
     ================================================================= */
  return (
    <div className="min-h-screen bg-bg-cream bg-sprinkle-pattern bg-cupcake-pattern text-text-primary font-sans">
      {/* Main content */}
      <div className="max-w-md mx-auto">
        {tab === "dashboard" && renderDashboard()}
        {tab === "orders" && (
          <OrdersListScreen
            orders={orders}
            onToggleDone={handleToggleDone}
            onDelete={handleDelete}
            onBack={() => setTab("dashboard")}
          />
        )}
        {tab === "ai" && (
          <AiToolsScreen onBack={() => setTab("dashboard")} />
        )}
        {tab === "catalogue" && (
          <CatalogueScreen
            onBack={() => setTab("dashboard")}
            items={catalogue}
            onSave={handleAddCatalogue}
            onDelete={handleDeleteCatalogue}
          />
        )}
      </div>

      {/* Add Order Modal */}
      {showAddModal && (
        <AddOrderModal
          onClose={() => { setShowAddModal(false); setPendingAiPrice(null); setPendingAiDescription(null); }}
          onAdd={handleAddOrder}
          initialPrice={pendingAiPrice}
          initialDescription={pendingAiDescription}
        />
      )}

      {/* AI Price Helper Modal */}
      {showAiPriceModal && (
        <AIPriceHelperModal
          onClose={() => setShowAiPriceModal(false)}
          onUsePrice={handleUseAiPrice}
        />
      )}

      {/* Toast notification */}
      {toastMessage && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] ${isToastExiting ? 'animate-toast-out' : 'animate-toast-in'}`}>
          <div className="bg-chocolate text-bg-cream font-sans text-sm font-semibold px-5 py-3 rounded-2xl shadow-lg border border-white/10 flex items-center gap-2">
            <span>✅</span>
            {toastMessage}
          </div>
        </div>
      )}

      {/* ===== BOTTOM NAVIGATION ===== */}
      {showBottomNav && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-xl border-t border-border-soft">
          <div className="max-w-md mx-auto flex items-center justify-around px-2 py-2">
            {/* Dashboard */}
            <button
              onClick={() => setTab("dashboard")}
              className={`flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-xl transition-all duration-150 cursor-pointer ${
                tab === "dashboard" ? "text-gold" : "text-text-muted/60 hover:text-text-secondary"
              }`}
            >
              <span className="text-xl">🏠</span>
              <span className="text-[10px] font-bold font-sans tracking-wide">Dashboard</span>
            </button>

            {/* Add Order */}
            <button
              onClick={() => setShowAddModal(true)}
              className={`flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-xl transition-all duration-150 cursor-pointer ${
                false ? "text-gold" : "text-text-muted/60 hover:text-text-secondary"
              }`}
            >
              <span className="text-xl">➕</span>
              <span className="text-[10px] font-bold font-sans tracking-wide">Add</span>
            </button>

            {/* Orders */}
            <button
              onClick={() => setTab("orders")}
              className={`flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-xl transition-all duration-150 cursor-pointer ${
                tab === "orders" ? "text-gold" : "text-text-muted/60 hover:text-text-secondary"
              }`}
            >
              <span className="text-xl">📋</span>
              <span className="text-[10px] font-bold font-sans tracking-wide">Orders</span>
            </button>

            {/* Catalogue */}
            <button
              onClick={() => setTab("catalogue")}
              className={`flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-xl transition-all duration-150 cursor-pointer ${
                tab === "catalogue" ? "text-gold" : "text-text-muted/60 hover:text-text-secondary"
              }`}
            >
              <span className="text-xl">🖼️</span>
              <span className="text-[10px] font-bold font-sans tracking-wide">Catalogue</span>
            </button>

            {/* AI Tools */}
            <button
              onClick={() => setTab("ai")}
              className={`flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-xl transition-all duration-150 cursor-pointer ${
                tab === "ai" ? "text-gold" : "text-text-muted/60 hover:text-text-secondary"
              }`}
            >
              <span className="text-xl">💡</span>
              <span className="text-[10px] font-bold font-sans tracking-wide">AI Tools</span>
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}