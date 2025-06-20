const CACHE_NAME = "music-player-v2"
const urlsToCache = [
  "/",
  "/index.html",
  "/styles.css",
  "/script.js",
  "/manifest.json",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css",
]

let currentTrack = null
let isPlaying = false
let playbackPosition = 0
let playbackDuration = 0

// Установка Service Worker
self.addEventListener("install", (event) => {
  console.log("Service Worker установлен")
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache)
    }),
  )
  self.skipWaiting()
})

// Активация Service Worker
self.addEventListener("activate", (event) => {
  console.log("Service Worker активирован")
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName)
          }
        }),
      )
    }),
  )
  self.clients.claim()
})

// Обработка запросов
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request)
    }),
  )
})

// Обработка сообщений от основного потока
self.addEventListener("message", (event) => {
  const { type, data } = event.data

  switch (type) {
    case "TRACK_CHANGED":
      currentTrack = data
      updateMediaSession(data)
      break
    case "PLAYBACK_STATE_CHANGED":
      isPlaying = data.isPlaying
      playbackPosition = data.position || 0
      playbackDuration = data.duration || 0
      updatePlaybackState(data)
      break
    case "KEEP_ALIVE":
      // Поддерживаем Service Worker активным
      break
    case "INIT_MEDIA_SESSION":
      initializeMediaSession()
      break
  }
})

// Инициализация Media Session
function initializeMediaSession() {
  if ("mediaSession" in navigator) {
    console.log("Инициализация Media Session")

    // Устанавливаем обработчики действий
    const actionHandlers = [
      ["play", () => sendMessageToClient({ type: "PLAY" })],
      ["pause", () => sendMessageToClient({ type: "PAUSE" })],
      ["previoustrack", () => sendMessageToClient({ type: "PREVIOUS" })],
      ["nexttrack", () => sendMessageToClient({ type: "NEXT" })],
      ["stop", () => sendMessageToClient({ type: "STOP" })],
      [
        "seekbackward",
        (details) =>
          sendMessageToClient({
            type: "SEEK",
            data: { offset: -(details.seekOffset || 10) },
          }),
      ],
      [
        "seekforward",
        (details) =>
          sendMessageToClient({
            type: "SEEK",
            data: { offset: details.seekOffset || 10 },
          }),
      ],
      [
        "seekto",
        (details) =>
          sendMessageToClient({
            type: "SEEK_TO",
            data: { time: details.seekTime },
          }),
      ],
    ]

    for (const [action, handler] of actionHandlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler)
        console.log(`Установлен обработчик для ${action}`)
      } catch (error) {
        console.log(`Действие ${action} не поддерживается:`, error)
      }
    }
  }
}

// Обновление Media Session
function updateMediaSession(trackData) {
  if ("mediaSession" in navigator && trackData) {
    console.log("Обновление Media Session:", trackData.title)

    navigator.mediaSession.metadata = new MediaMetadata({
      title: trackData.title || "Неизвестный трек",
      artist: trackData.artist || "Неизвестный исполнитель",
      album: trackData.album || "Мой плейлист",
      artwork: trackData.artwork
        ? [
            { src: trackData.artwork, sizes: "96x96", type: "image/jpeg" },
            { src: trackData.artwork, sizes: "128x128", type: "image/jpeg" },
            { src: trackData.artwork, sizes: "192x192", type: "image/jpeg" },
            { src: trackData.artwork, sizes: "256x256", type: "image/jpeg" },
            { src: trackData.artwork, sizes: "384x384", type: "image/jpeg" },
            { src: trackData.artwork, sizes: "512x512", type: "image/jpeg" },
          ]
        : [
            {
              src: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTkyIiBoZWlnaHQ9IjE5MiIgdmlld0JveD0iMCAwIDE5MiAxOTIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxOTIiIGhlaWdodD0iMTkyIiBmaWxsPSIjMDAwMDAwIi8+CjxwYXRoIGQ9Ik05NiA0OEM3My45MDg2IDQ4IDU2IDY1LjkwODYgNTYgODhWMTA0QzU2IDEyNi4wOTEgNzMuOTA4NiAxNDQgOTYgMTQ0QzExOC4wOTEgMTQ0IDEzNiAxMjYuMDkxIDEzNiAxMDRWODhDMTM2IDY1LjkwODYgMTE4LjA5MSA0OCA5NiA0OFoiIGZpbGw9IiNGRkZGRkYiLz4KPHBhdGggZD0iTTk2IDY0QzgyLjc0NTIgNjQgNzIgNzQuNzQ1MiA3MiA4OFYxMDRDNzIgMTE3LjI1NSA4Mi43NDUyIDEyOCA5NiAxMjhDMTA5LjI1NSAxMjggMTIwIDExNy4yNTUgMTIwIDEwNFY4OEMxMjAgNzQuNzQ1MiAxMDkuMjU1IDY0IDk2IDY0WiIgZmlsbD0iIzAwMDAwMCIvPgo8L3N2Zz4K",
              sizes: "192x192",
              type: "image/svg+xml",
            },
          ],
    })
  }
}

// Обновление состояния воспроизведения
function updatePlaybackState(stateData) {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = stateData.isPlaying ? "playing" : "paused"

    console.log("Обновление состояния воспроизведения:", {
      isPlaying: stateData.isPlaying,
      position: stateData.position,
      duration: stateData.duration,
    })

    if (stateData.position !== undefined && stateData.duration !== undefined && stateData.duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: stateData.duration,
          playbackRate: stateData.playbackRate || 1.0,
          position: Math.min(stateData.position, stateData.duration),
        })
      } catch (error) {
        console.log("Ошибка установки позиции:", error)
      }
    }
  }
}

// Отправка сообщения клиенту
function sendMessageToClient(message) {
  console.log("Отправка сообщения клиенту:", message)

  self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then((clients) => {
    if (clients.length > 0) {
      clients.forEach((client) => {
        client.postMessage(message)
      })
    } else {
      // Если нет активных клиентов, открываем новое окно
      self.clients.openWindow("/").then((client) => {
        if (client) {
          // Ждем загрузки и отправляем сообщение
          setTimeout(() => {
            client.postMessage(message)
          }, 1000)
        }
      })
    }
  })
}

// Обработка закрытия уведомления
self.addEventListener("notificationclick", (event) => {
  console.log("Клик по уведомлению")
  event.notification.close()

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Ищем открытую вкладку с плеером
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          return client.focus()
        }
      }
      // Если нет открытых вкладок, открываем новую
      return self.clients.openWindow("/")
    }),
  )
})

// Обработка push-уведомлений (для будущего использования)
self.addEventListener("push", (event) => {
  console.log("Push уведомление получено")

  if (event.data) {
    const data = event.data.json()

    event.waitUntil(
      self.registration.showNotification(data.title || "Музыкальный плеер", {
        body: data.body || "Новое уведомление",
        icon: "/icon-192.png",
        badge: "/icon-96.png",
        tag: "music-player",
        requireInteraction: false,
        silent: true,
      }),
    )
  }
})

// Поддержание активности Service Worker
setInterval(() => {
  console.log("Service Worker активен")
}, 30000)

// Инициализация при запуске
initializeMediaSession()
