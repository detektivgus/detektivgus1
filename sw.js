const CACHE_NAME = "music-player-v1"
const urlsToCache = [
  "/",
  "/index.html",
  "/styles.css",
  "/script.js",
  "/manifest.json",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css",
]

// Установка Service Worker
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache)))
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
      updateMediaSession(data)
      break
    case "PLAYBACK_STATE_CHANGED":
      updatePlaybackState(data)
      break
    case "KEEP_ALIVE":
      // Поддерживаем Service Worker активным
      break
  }
})

// Обновление Media Session
function updateMediaSession(trackData) {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: trackData.title,
      artist: trackData.artist,
      album: trackData.album || "Неизвестный альбом",
      artwork: trackData.artwork
        ? [
            { src: trackData.artwork, sizes: "96x96", type: "image/jpeg" },
            { src: trackData.artwork, sizes: "128x128", type: "image/jpeg" },
            { src: trackData.artwork, sizes: "192x192", type: "image/jpeg" },
            { src: trackData.artwork, sizes: "256x256", type: "image/jpeg" },
            { src: trackData.artwork, sizes: "384x384", type: "image/jpeg" },
            { src: trackData.artwork, sizes: "512x512", type: "image/jpeg" },
          ]
        : [],
    })

    // Устанавливаем обработчики действий
    navigator.mediaSession.setActionHandler("play", () => {
      sendMessageToClient({ type: "PLAY" })
    })

    navigator.mediaSession.setActionHandler("pause", () => {
      sendMessageToClient({ type: "PAUSE" })
    })

    navigator.mediaSession.setActionHandler("previoustrack", () => {
      sendMessageToClient({ type: "PREVIOUS" })
    })

    navigator.mediaSession.setActionHandler("nexttrack", () => {
      sendMessageToClient({ type: "NEXT" })
    })

    navigator.mediaSession.setActionHandler("seekbackward", (details) => {
      sendMessageToClient({ type: "SEEK", data: { offset: -(details.seekOffset || 10) } })
    })

    navigator.mediaSession.setActionHandler("seekforward", (details) => {
      sendMessageToClient({ type: "SEEK", data: { offset: details.seekOffset || 10 } })
    })

    navigator.mediaSession.setActionHandler("seekto", (details) => {
      sendMessageToClient({ type: "SEEK_TO", data: { time: details.seekTime } })
    })
  }
}

// Обновление состояния воспроизведения
function updatePlaybackState(stateData) {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = stateData.isPlaying ? "playing" : "paused"

    if (stateData.position !== undefined && stateData.duration !== undefined) {
      navigator.mediaSession.setPositionState({
        duration: stateData.duration,
        playbackRate: stateData.playbackRate || 1.0,
        position: stateData.position,
      })
    }
  }
}

// Отправка сообщения клиенту
function sendMessageToClient(message) {
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage(message)
    })
  })
}

// Обработка закрытия вкладки
self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  event.waitUntil(
    self.clients.matchAll().then((clients) => {
      // Если есть открытые вкладки, фокусируемся на них
      if (clients.length > 0) {
        return clients[0].focus()
      }
      // Иначе открываем новую вкладку
      return self.clients.openWindow("/")
    }),
  )
})
