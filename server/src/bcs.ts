import { config } from "./config.js";
import { logger } from "./logger.js";

const TOKEN_URL =
  "https://be.broker.ru/trade-api-keycloak/realms/tradeapi/protocol/openid-connect/token";

const API = {
  portfolio: "https://be.broker.ru/trade-api-bff-portfolio/api/v1/portfolio",
  limits: "https://be.broker.ru/trade-api-bff-limit/api/v1/limits",
  orders: "https://be.broker.ru/trade-api-bff-operations/api/v1/orders",
  ordersSearch:
    "https://be.broker.ru/trade-api-bff-order-details/api/v1/orders/search",
  tradesSearch:
    "https://be.broker.ru/trade-api-bff-trade-details/api/v1/trades/search",
  candles:
    "https://be.broker.ru/trade-api-market-data-connector/api/v1/candles-chart",
  instrumentsByTickers:
    "https://be.broker.ru/trade-api-information-service/api/v1/instruments/by-tickers",
  instrumentsByIsins:
    "https://be.broker.ru/trade-api-information-service/api/v1/instruments/by-isins",
  instrumentsByType:
    "https://be.broker.ru/trade-api-information-service/api/v1/instruments/by-type",
  instrumentsDiscounts:
    "https://be.broker.ru/trade-api-bff-marginal-indicators/api/v1/instruments-discounts",
  tradingStatus:
    "https://be.broker.ru/trade-api-information-service/api/v1/trading-schedule/status",
  dailySchedule:
    "https://be.broker.ru/trade-api-information-service/api/v1/trading-schedule/daily-schedule",
};

class TokenManager {
  private accessToken: string | null = null;
  private expiresAt = 0;

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) {
      return this.accessToken;
    }
    await this.refresh();
    if (!this.accessToken) {
      throw new Error("access token is empty after refresh");
    }
    return this.accessToken;
  }

  private async refresh() {
    if (!config.bcs.refreshToken) {
      throw new Error("BCS_REFRESH_TOKEN is empty");
    }
    logger.debug("bcs.token.refresh.start");
    const body = new URLSearchParams({
      client_id: config.bcs.clientId,
      refresh_token: config.bcs.refreshToken,
      grant_type: "refresh_token",
    });

    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!resp.ok) {
      const text = await resp.text();
      logger.error("bcs.token.refresh.error", { status: resp.status, body: text });
      throw new Error(`token refresh failed: ${resp.status} ${text}`);
    }
    const data = await resp.json();
    this.accessToken = data.access_token;
    const expiresIn = Number(data.expires_in || 0);
    this.expiresAt = Date.now() + expiresIn * 1000;
    logger.debug("bcs.token.refresh.ok", { expiresIn });
  }
}

const tokens = new TokenManager();

async function request<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const token = await tokens.getAccessToken();
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };
  const method = (options.method || "GET").toUpperCase();
  const started = Date.now();
  logger.debug("bcs.request", { method, url });
  const resp = await fetch(url, { ...options, headers });
  if (!resp.ok) {
    const text = await resp.text();
    logger.error("bcs.response.error", {
      method,
      url,
      status: resp.status,
      body: text,
      ms: Date.now() - started,
    });
    throw new Error(`${resp.status} ${text}`);
  }
  logger.debug("bcs.response.ok", {
    method,
    url,
    status: resp.status,
    ms: Date.now() - started,
  });
  return resp.json() as Promise<T>;
}

export const bcs = {
  async getPortfolio() {
    return request(API.portfolio);
  },
  async getLimits() {
    return request(API.limits);
  },
  async createOrder(payload: any) {
    return request(API.orders, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  async cancelOrder(originalId: string, payload: any) {
    return request(`${API.orders}/${originalId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  async replaceOrder(originalId: string, payload: any) {
    return request(`${API.orders}/${originalId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  async getOrderStatus(originalId: string) {
    return request(`${API.orders}/${originalId}`);
  },
  async searchOrders(query: URLSearchParams, body: any) {
    return request(`${API.ordersSearch}?${query.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  },
  async searchTrades(query: URLSearchParams, body: any) {
    return request(`${API.tradesSearch}?${query.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  },
  async getCandles(query: URLSearchParams) {
    return request(`${API.candles}?${query.toString()}`);
  },
  async instrumentsByTickers(query: URLSearchParams, body: any) {
    return request(`${API.instrumentsByTickers}?${query.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  },
  async instrumentsByIsins(query: URLSearchParams, body: any) {
    return request(`${API.instrumentsByIsins}?${query.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  },
  async instrumentsByType(query: URLSearchParams) {
    return request(`${API.instrumentsByType}?${query.toString()}`);
  },
  async instrumentsDiscounts() {
    return request(API.instrumentsDiscounts);
  },
  async tradingStatus(query: URLSearchParams) {
    return request(`${API.tradingStatus}?${query.toString()}`);
  },
  async dailySchedule(query: URLSearchParams) {
    return request(`${API.dailySchedule}?${query.toString()}`);
  },
};
