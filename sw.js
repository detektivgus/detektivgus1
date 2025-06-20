const CACHE_NAME = "music-player-v2"
const urlsToCache = [
  "/",
  "/index.html",
  "/styles.css",
  "/script.js",
  "/manifest.json",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css",
]

// Глобальные переменные для отслеживания состояния
let currentTrack = null
let isPlaying = false
let playbackPosition = 0
let playbackDuration = 0

// Установка Service Worker
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache)))
  self.skipWaiting()
})

// Активация Service Worker
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

// Обработка запросов
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Возвращаем кэшированную версию или загружаем из сети
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
    case "REGISTER_BACKGROUND_SYNC":
      // Регистрируем фоновую синхронизацию
      break
  }
})

// Обновление Media Session
function updateMediaSession(trackData) {
  if ("mediaSession" in navigator) {
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
        : [{ src: "/favicon.ico", sizes: "192x192", type: "image/x-icon" }],
    })

    // Устанавливаем все доступные обработчики действий
    const actions = [
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

    actions.forEach(([action, handler]) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler)
      } catch (error) {
        console.log(`Действие ${action} не поддерживается`)
      }
    })
  }
}

// Обновление состояния воспроизведения
function updatePlaybackState(stateData) {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = stateData.isPlaying ? "playing" : "paused"

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
  self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then((clients) => {
    if (clients.length > 0) {
      clients.forEach((client) => {
        client.postMessage(message)
      })
    }
  })
}

// Поддержка фонового воспроизведения
self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      if (clients.length > 0) {
        return clients[0].focus()
      }
      return self.clients.openWindow("/")
    }),
  )
})

// Периодическая фоновая синхронизация (если поддерживается)
self.addEventListener("sync", (event) => {
  if (event.tag === "background-playback") {
    event.waitUntil(maintainPlayback())
  }
})

function maintainPlayback() {
  return self.clients.matchAll().then((clients) => {
    if (clients.length > 0) {
      clients[0].postMessage({ type: "MAINTAIN_PLAYBACK" })
    }
  })
}

// Обработка push-уведомлений (для будущего использования)
self.addEventListener("push", (event) => {
  if (event.data) {
    const data = event.data.json()
    if (data.type === "PLAYBACK_CONTROL") {
      sendMessageToClient(data.action)
    }
  }
})
