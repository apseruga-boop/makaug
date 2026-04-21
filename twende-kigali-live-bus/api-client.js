(function(){
  const defaults = {
    useLiveApi: false,
    baseUrl: "",
    mapProvider: "leaflet-openstreetmap",
    googleMapsApiKey: "",
    mapboxAccessToken: "",
    paymentProviders: {
      mtnMomo: { enabled: false, collectionsBaseUrl: "" },
      airtelMoney: { enabled: false, baseUrl: "" },
      cardProcessor: { enabled: false, publicKey: "" }
    },
    transitFeeds: {
      gtfsStaticUrl: "",
      gtfsRealtimeVehiclePositionsUrl: "",
      gtfsRealtimeTripUpdatesUrl: "",
      gtfsRealtimeAlertsUrl: ""
    },
    tapGo: {
      partnerBaseUrl: "",
      partnerId: ""
    }
  };

  const config = window.TWENDE_CONFIG = Object.assign({}, defaults, window.TWENDE_CONFIG || {});

  async function request(path, options = {}){
    if(!config.useLiveApi || !config.baseUrl){
      return { ok: false, offline: true, reason: "Live API is not configured yet." };
    }

    const response = await fetch(config.baseUrl.replace(/\/$/, "") + path, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });

    const data = await response.json().catch(() => ({}));
    if(!response.ok){
      throw new Error(data.message || `Request failed: ${response.status}`);
    }
    return data;
  }

  window.TwendeApiClient = {
    config,
    routes: {
      list: () => request("/routes"),
      arrivals: (stopId, routeId) => request(`/stops/${encodeURIComponent(stopId)}/arrivals?routeId=${encodeURIComponent(routeId)}`),
      liveVehicles: (routeId) => request(`/live/vehicles?routeId=${encodeURIComponent(routeId)}`),
      alerts: (routeId) => request(`/live/alerts?routeId=${encodeURIComponent(routeId)}`)
    },
    cards: {
      link: (payload) => request("/cards/link", { method: "POST", body: JSON.stringify(payload) }),
      create: (payload) => request("/cards/create", { method: "POST", body: JSON.stringify(payload) }),
      balance: (cardId) => request(`/cards/${encodeURIComponent(cardId)}/balance`),
      topup: (cardId, payload) => request(`/cards/${encodeURIComponent(cardId)}/topups`, { method: "POST", body: JSON.stringify(payload) }),
      transactions: (cardId) => request(`/cards/${encodeURIComponent(cardId)}/transactions`)
    },
    payments: {
      topupIntent: (payload) => request("/payments/topup-intents", { method: "POST", body: JSON.stringify(payload) }),
      ticketIntent: (payload) => request("/payments/ticket-intents", { method: "POST", body: JSON.stringify(payload) })
    },
    alerts: {
      subscribe: (payload) => request("/alerts/subscriptions", { method: "POST", body: JSON.stringify(payload) }),
      list: () => request("/alerts/subscriptions")
    }
  };
})();
