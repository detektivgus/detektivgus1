class MusicPlayer {
  constructor() {
    this.tracks = []
    this.playlists = []
    this.currentTrackIndex = 0
    this.currentPlaylist = null
    this.isPlaying = false
    this.isShuffled = false
    this.repeatMode = 0 // 0: no repeat, 1: repeat all, 2: repeat one
    this.audio = document.getElementById("audioPlayer")
    this.audioContext = null
    this.analyser = null
    this.dataArray = null
    this.currentEditingTrack = null
    this.currentView = "tracks"
    this.selectedTracks = new Set()
    this.isBackground = false
    this.wakeLock = null
    this.backgroundNotification = null
    this.miniPlayer = null
    this.backgroundIndicator = null
    this.db = null // Добавляем инициализацию

    this.initializeElements()
    this.bindEvents()
    this.initializeVisualizer()
    this.initializeDatabase()
  }

  async initializeDatabase() {
    try {
      this.db = await this.openDatabase()
      console.log("База данных инициализирована")

      // Проверяем, что все хранилища созданы
      if (!this.db.objectStoreNames.contains("audioFiles") || !this.db.objectStoreNames.contains("images")) {
        console.log("Хранилища не найдены, пересоздаем базу данных...")
        this.db.close()
        await this.deleteDatabase()
        this.db = await this.openDatabase()
      }

      await this.loadData()
    } catch (error) {
      console.error("Ошибка инициализации базы данных:", error)
      alert("Ошибка инициализации базы данных. Попробуйте обновить страницу.")
    }
  }

  openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("MusicPlayerDB", 2) // Увеличиваем версию

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        console.log("База данных открыта, версия:", db.version)
        console.log("Доступные хранилища:", Array.from(db.objectStoreNames))
        resolve(db)
      }

      request.onupgradeneeded = (e) => {
        const db = e.target.result
        console.log("Обновление базы данных с версии", e.oldVersion, "до", e.newVersion)

        // Удаляем старые хранилища если они есть
        if (db.objectStoreNames.contains("audioFiles")) {
          db.deleteObjectStore("audioFiles")
        }
        if (db.objectStoreNames.contains("images")) {
          db.deleteObjectStore("images")
        }

        // Создаем новые хранилища
        const audioStore = db.createObjectStore("audioFiles", { keyPath: "id" })
        const imageStore = db.createObjectStore("images", { keyPath: "id" })

        console.log("Хранилища созданы:", audioStore.name, imageStore.name)
      }

      request.onblocked = () => {
        console.log("Обновление базы данных заблокировано")
        alert("Закройте другие вкладки с плеером для обновления базы данных")
      }
    })
  }

  deleteDatabase() {
    return new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase("MusicPlayerDB")
      deleteRequest.onsuccess = () => resolve()
      deleteRequest.onerror = () => reject(deleteRequest.error)
      deleteRequest.onblocked = () => {
        console.log("Удаление базы данных заблокировано")
        resolve()
      }
    })
  }

  async saveFileToIndexedDB(file, type) {
    if (!this.db) {
      throw new Error("База данных не инициализирована")
    }

    if (!this.db.objectStoreNames.contains(type)) {
      throw new Error(`Хранилище ${type} не найдено`)
    }

    const id = Date.now() + Math.random()
    const fileData = {
      id: id,
      name: file.name,
      type: file.type,
      data: await file.arrayBuffer(),
    }

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([type], "readwrite")
        const store = transaction.objectStore(type)
        const request = store.add(fileData)

        request.onsuccess = () => {
          console.log(`Файл ${file.name} сохранен с ID: ${id}`)
          resolve(id)
        }
        request.onerror = () => {
          console.error("Ошибка сохранения файла:", request.error)
          reject(request.error)
        }

        transaction.onerror = () => {
          console.error("Ошибка транзакции:", transaction.error)
          reject(transaction.error)
        }
      } catch (error) {
        console.error("Ошибка создания транзакции:", error)
        reject(error)
      }
    })
  }

  async getFileFromIndexedDB(id, type) {
    if (!this.db) {
      throw new Error("База данных не инициализирована")
    }

    if (!this.db.objectStoreNames.contains(type)) {
      throw new Error(`Хранилище ${type} не найдено`)
    }

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([type], "readonly")
        const store = transaction.objectStore(type)
        const request = store.get(id)

        request.onsuccess = () => {
          const result = request.result
          if (result) {
            const blob = new Blob([result.data], { type: result.type })
            resolve(URL.createObjectURL(blob))
          } else {
            resolve(null)
          }
        }
        request.onerror = () => reject(request.error)
      } catch (error) {
        reject(error)
      }
    })
  }

  async deleteFileFromIndexedDB(id, type) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([type], "readwrite")
      const store = transaction.objectStore(type)
      const request = store.delete(id)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  initializeElements() {
    // Элементы управления
    this.playBtn = document.getElementById("playBtn")
    this.prevBtn = document.getElementById("prevBtn")
    this.nextBtn = document.getElementById("nextBtn")
    this.shuffleBtn = document.getElementById("shuffleBtn")
    this.repeatBtn = document.getElementById("repeatBtn")

    // Прогресс и громкость
    this.progressSlider = document.getElementById("progressSlider")
    this.progressFill = document.getElementById("progressFill")
    this.volumeSlider = document.getElementById("volumeSlider")
    this.volumeBtn = document.getElementById("volumeBtn")

    // Информация о треке
    this.currentTitle = document.getElementById("currentTitle")
    this.currentArtist = document.getElementById("currentArtist")
    this.currentCover = document.getElementById("currentCover")
    this.trackTitleLarge = document.getElementById("trackTitleLarge")
    this.trackArtistLarge = document.getElementById("trackArtistLarge")
    this.currentTime = document.getElementById("currentTime")
    this.totalTime = document.getElementById("totalTime")

    // Вкладки и списки
    this.tracksTab = document.getElementById("tracksTab")
    this.playlistsTab = document.getElementById("playlistsTab")
    this.tracksView = document.getElementById("tracksView")
    this.playlistsView = document.getElementById("playlistsView")
    this.trackList = document.getElementById("trackList")
    this.playlistsList = document.getElementById("playlistsList")
    this.playlistTracks = document.getElementById("playlistTracks")
    this.playlistTracksList = document.getElementById("playlistTracksList")
    this.currentPlaylistName = document.getElementById("currentPlaylistName")
    this.visualizer = document.getElementById("visualizer")

    // Кнопки
    this.addMusicBtn = document.getElementById("addMusicBtn")
    this.resetDataBtn = document.getElementById("resetDataBtn")
    this.createPlaylistBtn = document.getElementById("createPlaylistBtn")
    this.backToPlaylistsBtn = document.getElementById("backToPlaylistsBtn")
    this.addToPlaylistBtn = document.getElementById("addToPlaylistBtn")

    // Файловые инпуты
    this.musicFileInput = document.getElementById("musicFileInput")
    this.imageFileInput = document.getElementById("imageFileInput")

    // Модальные окна
    this.editModal = document.getElementById("editTrackModal")
    this.createPlaylistModal = document.getElementById("createPlaylistModal")
    this.addToPlaylistModal = document.getElementById("addToPlaylistModal")
    this.resetConfirmModal = document.getElementById("resetConfirmModal")

    // Элементы модальных окон
    this.coverPreview = document.getElementById("coverPreview")
    this.editTitle = document.getElementById("editTitle")
    this.editArtist = document.getElementById("editArtist")
    this.playlistName = document.getElementById("playlistName")
    this.playlistDescription = document.getElementById("playlistDescription")
    this.availableTracksList = document.getElementById("availableTracksList")

    // Элементы фонового режима
    this.backgroundNotification = document.getElementById("backgroundNotification")
    this.closeNotificationBtn = document.getElementById("closeNotification")

    // Добавляем новые элементы в initializeElements()
    this.addFolderBtn = document.getElementById("addFolderBtn")
    this.folderInput = document.getElementById("folderInput")
    this.dropZone = document.getElementById("dropZone")
    this.selectFilesBtn = document.getElementById("selectFilesBtn")
    this.selectFolderBtn = document.getElementById("selectFolderBtn")
    this.uploadProgress = document.getElementById("uploadProgress")
    this.uploadProgressBar = document.getElementById("uploadProgressBar")
    this.uploadStatus = document.getElementById("uploadStatus")
  }

  bindEvents() {
    // Управление воспроизведением
    this.playBtn.addEventListener("click", () => this.togglePlay())
    this.prevBtn.addEventListener("click", () => this.previousTrack())
    this.nextBtn.addEventListener("click", () => this.nextTrack())
    this.shuffleBtn.addEventListener("click", () => this.toggleShuffle())
    this.repeatBtn.addEventListener("click", () => this.toggleRepeat())

    // Прогресс и громкость
    this.progressSlider.addEventListener("input", () => this.seekTo())
    this.volumeSlider.addEventListener("input", () => this.setVolume())
    this.volumeBtn.addEventListener("click", () => this.toggleMute())

    // События аудио
    this.audio.addEventListener("loadedmetadata", () => this.updateDuration())
    this.audio.addEventListener("timeupdate", () => this.updateProgress())
    this.audio.addEventListener("ended", () => this.handleTrackEnd())

    // Вкладки
    this.tracksTab.addEventListener("click", () => this.switchToTracksView())
    this.playlistsTab.addEventListener("click", () => this.switchToPlaylistsView())

    // Кнопки
    this.addMusicBtn.addEventListener("click", () => this.musicFileInput.click())
    this.resetDataBtn.addEventListener("click", () => this.showResetConfirmModal())
    this.createPlaylistBtn.addEventListener("click", () => this.showCreatePlaylistModal())
    this.backToPlaylistsBtn.addEventListener("click", () => this.backToPlaylists())
    this.addToPlaylistBtn.addEventListener("click", () => this.showAddToPlaylistModal())

    // Файловые инпуты
    this.musicFileInput.addEventListener("change", (e) => this.handleMusicFiles(e))
    this.imageFileInput.addEventListener("change", (e) => this.handleImageFile(e))

    // Модальные окна - редактирование трека
    document.getElementById("closeEditModal").addEventListener("click", () => this.hideEditModal())
    document.getElementById("cancelEditBtn").addEventListener("click", () => this.hideEditModal())
    document.getElementById("saveEditBtn").addEventListener("click", () => this.saveTrackEdit())
    document.getElementById("changeCoverBtn").addEventListener("click", () => this.imageFileInput.click())

    // Модальные окна - создание плейлиста
    document.getElementById("closeCreatePlaylistModal").addEventListener("click", () => this.hideCreatePlaylistModal())
    document.getElementById("cancelCreatePlaylistBtn").addEventListener("click", () => this.hideCreatePlaylistModal())
    document.getElementById("saveCreatePlaylistBtn").addEventListener("click", () => this.saveCreatePlaylist())

    // Модальные окна - добавление в плейлист
    document.getElementById("closeAddToPlaylistModal").addEventListener("click", () => this.hideAddToPlaylistModal())
    document.getElementById("cancelAddToPlaylistBtn").addEventListener("click", () => this.hideAddToPlaylistModal())
    document.getElementById("saveAddToPlaylistBtn").addEventListener("click", () => this.saveAddToPlaylist())

    // Модальные окна - подтверждение сброса
    document.getElementById("closeResetConfirmModal").addEventListener("click", () => this.hideResetConfirmModal())
    document.getElementById("cancelResetBtn").addEventListener("click", () => this.hideResetConfirmModal())
    document
      .getElementById("confirmResetBtn")
      .addEventListener("click", () => this.confirmReset())

    // Закрытие модальных окон по клику вне их
    ;[this.editModal, this.createPlaylistModal, this.addToPlaylistModal, this.resetConfirmModal].forEach((modal) => {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          modal.classList.remove("show")
        }
      })
    })

    // Drag & Drop
    document.addEventListener("dragover", (e) => e.preventDefault())
    document.addEventListener("drop", (e) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files)
      const audioFiles = files.filter((file) => file.type.startsWith("audio/"))
      if (audioFiles.length > 0) {
        this.processAudioFiles(audioFiles)
      }
    })

    // Установка начальной громкости
    this.setVolume()

    // События фонового режима
    this.closeNotificationBtn?.addEventListener("click", () => this.hideBackgroundNotification())

    // Обработка видимости страницы
    document.addEventListener("visibilitychange", () => this.handleVisibilityChange())

    // Обработка сообщений от Service Worker
    navigator.serviceWorker?.addEventListener("message", (event) => this.handleServiceWorkerMessage(event))

    // Регистрация Service Worker
    this.registerServiceWorker()

    // Добавляем новые события в bindEvents()
    this.addFolderBtn.addEventListener("click", () => this.folderInput.click())
    this.folderInput.addEventListener("change", (e) => this.handleFolderSelect(e))
    this.selectFilesBtn.addEventListener("click", () => this.musicFileInput.click())
    this.selectFolderBtn.addEventListener("click", () => this.folderInput.click())

    // Улучшенный Drag & Drop
    this.dropZone.addEventListener("dragover", (e) => {
      e.preventDefault()
      this.dropZone.classList.add("drag-over")
    })

    this.dropZone.addEventListener("dragleave", (e) => {
      e.preventDefault()
      this.dropZone.classList.remove("drag-over")
    })

    this.dropZone.addEventListener("drop", (e) => {
      e.preventDefault()
      this.dropZone.classList.remove("drag-over")

      const items = Array.from(e.dataTransfer.items)
      this.handleDroppedItems(items)
    })
  }

  // Визуализатор
  initializeVisualizer() {
    this.canvas = this.visualizer
    this.ctx = this.canvas.getContext("2d")

    this.resizeCanvas()
    window.addEventListener("resize", () => this.resizeCanvas())

    this.animate()
  }

  resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect()
    this.canvas.width = rect.width * window.devicePixelRatio
    this.canvas.height = rect.height * window.devicePixelRatio
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    this.canvas.style.width = rect.width + "px"
    this.canvas.style.height = rect.height + "px"
  }

  setupAudioContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 256

      const source = this.audioContext.createMediaElementSource(this.audio)
      source.connect(this.analyser)
      this.analyser.connect(this.audioContext.destination)

      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount)
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate())
    this.drawVisualizer()
  }

  drawVisualizer() {
    const rect = this.canvas.getBoundingClientRect()
    const width = rect.width
    const height = rect.height

    this.ctx.fillStyle = "#000000"
    this.ctx.fillRect(0, 0, width, height)

    if (this.analyser && this.isPlaying) {
      this.analyser.getByteFrequencyData(this.dataArray)

      const dotSize = 3
      const spacing = 8
      const cols = Math.floor(width / spacing)
      const rows = Math.floor(height / spacing)

      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const dataIndex = Math.floor((i / cols) * this.dataArray.length)
          const amplitude = this.dataArray[dataIndex] / 255

          const distance = Math.sqrt(Math.pow(i - cols / 2, 2) + Math.pow(j - rows / 2, 2))
          const wave = Math.sin(distance * 0.1 + Date.now() * 0.005) * 0.5 + 0.5

          const opacity = amplitude * wave * 0.8 + 0.2

          this.ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`
          this.ctx.beginPath()
          this.ctx.arc(
            i * spacing + spacing / 2,
            j * spacing + spacing / 2,
            dotSize * (amplitude * 0.5 + 0.5),
            0,
            Math.PI * 2,
          )
          this.ctx.fill()
        }
      }
    } else {
      const dotSize = 2
      const spacing = 8
      const cols = Math.floor(width / spacing)
      const rows = Math.floor(height / spacing)

      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const opacity = Math.random() * 0.3 + 0.1
          this.ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`
          this.ctx.beginPath()
          this.ctx.arc(i * spacing + spacing / 2, j * spacing + spacing / 2, dotSize, 0, Math.PI * 2)
          this.ctx.fill()
        }
      }
    }
  }

  // Управление файлами
  async handleMusicFiles(e) {
    const files = Array.from(e.target.files)
    await this.processAudioFiles(files)
  }

  async processAudioFiles(files) {
    await this.processAudioFilesWithProgress(files)
  }

  async handleImageFile(e) {
    const file = e.target.files[0]
    if (file && this.currentEditingTrack) {
      try {
        const imageId = await this.saveFileToIndexedDB(file, "images")
        const url = await this.getFileFromIndexedDB(imageId, "images")

        this.currentEditingTrack.cover = url
        this.currentEditingTrack.coverId = imageId
        this.coverPreview.innerHTML = `<img src="${url}" alt="Cover">`
      } catch (error) {
        console.error("Ошибка при добавлении изображения:", error)
      }
    }
  }

  // Управление вкладками
  switchToTracksView() {
    this.currentView = "tracks"
    this.tracksTab.classList.add("active")
    this.playlistsTab.classList.remove("active")
    this.tracksView.style.display = "flex"
    this.playlistsView.style.display = "none"
    this.updateTrackList()
  }

  switchToPlaylistsView() {
    this.currentView = "playlists"
    this.playlistsTab.classList.add("active")
    this.tracksTab.classList.remove("active")
    this.playlistsView.style.display = "flex"
    this.tracksView.style.display = "none"
    this.updatePlaylistsList()
  }

  // Управление воспроизведением
  togglePlay() {
    const tracks = this.getCurrentTrackList()
    if (tracks.length === 0) return

    if (this.isPlaying) {
      this.pause()
    } else {
      this.play()
    }
  }

  async play() {
    const tracks = this.getCurrentTrackList()
    if (tracks.length === 0) return

    const currentTrack = tracks[this.currentTrackIndex]
    if (!currentTrack) return

    if (!currentTrack.url) {
      currentTrack.url = await this.getFileFromIndexedDB(currentTrack.audioId, "audioFiles")
    }

    if (this.audio.src !== currentTrack.url) {
      this.audio.src = currentTrack.url
    }

    this.setupAudioContext()

    try {
      await this.audio.play()
      this.isPlaying = true
      this.playBtn.innerHTML = '<i class="fas fa-pause"></i>'
      this.updateCurrentTrackInfo()

      // Обновляем мини-плеер и Media Session
      if (this.isBackground) {
        this.updateMiniPlayer()
        this.updateMediaSession()
        this.showTrackNotification(currentTrack)
      }
      this.updateTrackList()
    } catch (error) {
      console.error("Ошибка воспроизведения:", error)
    }
  }

  pause() {
    this.audio.pause()
    this.isPlaying = false
    this.playBtn.innerHTML = '<i class="fas fa-play"></i>'

    // Обновляем мини-плеер
    if (this.isBackground) {
      this.updateMiniPlayer()
    }
  }

  previousTrack() {
    const tracks = this.getCurrentTrackList()
    if (tracks.length === 0) return

    this.currentTrackIndex = (this.currentTrackIndex - 1 + tracks.length) % tracks.length
    this.play()
  }

  nextTrack() {
    const tracks = this.getCurrentTrackList()
    if (tracks.length === 0) return

    if (this.isShuffled) {
      this.currentTrackIndex = Math.floor(Math.random() * tracks.length)
    } else {
      this.currentTrackIndex = (this.currentTrackIndex + 1) % tracks.length
    }
    this.play()
  }

  handleTrackEnd() {
    if (this.repeatMode === 2) {
      this.play()
    } else if (this.repeatMode === 1) {
      this.nextTrack()
    } else {
      const tracks = this.getCurrentTrackList()
      if (this.currentTrackIndex < tracks.length - 1) {
        this.nextTrack()
      } else {
        this.pause()
      }
    }
  }

  toggleShuffle() {
    this.isShuffled = !this.isShuffled
    this.shuffleBtn.classList.toggle("active", this.isShuffled)
  }

  toggleRepeat() {
    this.repeatMode = (this.repeatMode + 1) % 3
    this.repeatBtn.classList.toggle("active", this.repeatMode > 0)

    const icons = ["fa-repeat", "fa-repeat", "fa-repeat-1"]
    this.repeatBtn.innerHTML = `<i class="fas ${icons[this.repeatMode]}"></i>`
  }

  seekTo() {
    const seekTime = (this.progressSlider.value / 100) * this.audio.duration
    this.audio.currentTime = seekTime
  }

  setVolume() {
    this.audio.volume = this.volumeSlider.value / 100
    this.updateVolumeIcon()
  }

  toggleMute() {
    if (this.audio.volume > 0) {
      this.audio.volume = 0
      this.volumeSlider.value = 0
    } else {
      this.audio.volume = 0.7
      this.volumeSlider.value = 70
    }
    this.updateVolumeIcon()
  }

  updateVolumeIcon() {
    const volume = this.audio.volume
    let icon = "fa-volume-up"
    if (volume === 0) icon = "fa-volume-mute"
    else if (volume < 0.5) icon = "fa-volume-down"

    this.volumeBtn.innerHTML = `<i class="fas ${icon}"></i>`
  }

  // Обновление интерфейса
  updateProgress() {
    if (this.audio.duration) {
      const progressPercent = (this.audio.currentTime / this.audio.duration) * 100
      this.progressFill.style.width = progressPercent + "%"
      this.progressSlider.value = progressPercent
      this.currentTime.textContent = this.formatTime(this.audio.currentTime)
    }

    // Обновляем позицию в Media Session
    if (this.isBackground && this.audio.duration) {
      this.sendMessageToServiceWorker({
        type: "PLAYBACK_STATE_CHANGED",
        data: {
          isPlaying: this.isPlaying,
          position: this.audio.currentTime,
          duration: this.audio.duration,
        },
      })
    }
  }

  updateDuration() {
    this.totalTime.textContent = this.formatTime(this.audio.duration)
  }

  async updateCurrentTrackInfo() {
    const tracks = this.getCurrentTrackList()
    const currentTrack = tracks[this.currentTrackIndex]

    if (currentTrack) {
      this.currentTitle.textContent = currentTrack.title
      this.currentArtist.textContent = currentTrack.artist
      this.trackTitleLarge.textContent = currentTrack.title
      this.trackArtistLarge.textContent = currentTrack.artist

      if (currentTrack.coverId) {
        if (!currentTrack.cover) {
          currentTrack.cover = await this.getFileFromIndexedDB(currentTrack.coverId, "images")
        }
        this.currentCover.innerHTML = `<img src="${currentTrack.cover}" alt="Cover">`
      } else {
        this.currentCover.innerHTML = '<i class="fas fa-music"></i>'
      }
    }
  }

  async updateTrackList() {
    if (this.currentView !== "tracks" && !this.currentPlaylist) return

    const tracks = this.getCurrentTrackList()
    const container = this.currentPlaylist ? this.playlistTracksList : this.trackList

    container.innerHTML = ""

    for (let index = 0; index < tracks.length; index++) {
      const track = tracks[index]
      const trackElement = document.createElement("div")
      trackElement.className = "track-item"

      if (index === this.currentTrackIndex && this.isPlaying) {
        trackElement.classList.add("playing")
      }

      // Загружаем обложку если нужно
      let coverHtml = '<i class="fas fa-music"></i>'
      if (track.coverId && !track.cover) {
        track.cover = await this.getFileFromIndexedDB(track.coverId, "images")
      }
      if (track.cover) {
        coverHtml = `<img src="${track.cover}" alt="Cover">`
      }

      trackElement.innerHTML = `
                <div class="track-cover">
                    ${coverHtml}
                </div>
                <div class="track-info">
                    <div class="track-title">${track.title}</div>
                    <div class="track-artist">${track.artist}</div>
                </div>
                <div class="track-duration">${track.duration}</div>
                <div class="track-actions">
                    <button class="track-action-btn edit-track-btn" title="Редактировать">
                        <i class="fas fa-edit"></i>
                    </button>
                    ${
                      this.currentPlaylist
                        ? `
                        <button class="track-action-btn remove-from-playlist-btn" title="Удалить из плейлиста">
                            <i class="fas fa-times"></i>
                        </button>
                    `
                        : `
                        <button class="track-action-btn delete-track-btn" title="Удалить трек">
                            <i class="fas fa-trash"></i>
                        </button>
                    `
                    }
                </div>
            `

      // События для трека
      trackElement.addEventListener("click", (e) => {
        if (!e.target.closest(".track-actions")) {
          this.currentTrackIndex = index
          this.play()
        }
      })

      // События для кнопок действий
      const editBtn = trackElement.querySelector(".edit-track-btn")
      editBtn?.addEventListener("click", (e) => {
        e.stopPropagation()
        this.showEditModal(track, index)
      })

      const deleteBtn = trackElement.querySelector(".delete-track-btn")
      deleteBtn?.addEventListener("click", (e) => {
        e.stopPropagation()
        this.deleteTrack(index)
      })

      const removeBtn = trackElement.querySelector(".remove-from-playlist-btn")
      removeBtn?.addEventListener("click", (e) => {
        e.stopPropagation()
        this.removeFromPlaylist(index)
      })

      container.appendChild(trackElement)
    }

    this.updateDropZoneVisibility()
  }

  async updatePlaylistsList() {
    this.playlistsList.innerHTML = ""

    for (const playlist of this.playlists) {
      const playlistElement = document.createElement("div")
      playlistElement.className = "playlist-item"

      playlistElement.innerHTML = `
                <div class="playlist-cover">
                    <i class="fas fa-list"></i>
                </div>
                <div class="playlist-info">
                    <div class="playlist-name">${playlist.name}</div>
                    <div class="playlist-description">${playlist.trackIds.length} треков</div>
                </div>
            `

      playlistElement.addEventListener("click", () => this.openPlaylist(playlist))

      this.playlistsList.appendChild(playlistElement)
    }
  }

  // Управление плейлистами
  showCreatePlaylistModal() {
    this.playlistName.value = ""
    this.playlistDescription.value = ""
    this.createPlaylistModal.classList.add("show")
  }

  hideCreatePlaylistModal() {
    this.createPlaylistModal.classList.remove("show")
  }

  async saveCreatePlaylist() {
    const name = this.playlistName.value.trim()
    if (!name) return

    const playlist = {
      id: Date.now() + Math.random(),
      name: name,
      description: this.playlistDescription.value.trim(),
      trackIds: [],
      created: new Date().toISOString(),
    }

    this.playlists.push(playlist)
    await this.saveData()
    this.updatePlaylistsList()
    this.hideCreatePlaylistModal()
  }

  openPlaylist(playlist) {
    this.currentPlaylist = playlist
    this.currentTrackIndex = 0
    this.currentPlaylistName.textContent = playlist.name
    this.playlistsList.style.display = "none"
    this.playlistTracks.style.display = "flex"
    this.updateTrackList()
  }

  backToPlaylists() {
    this.currentPlaylist = null
    this.playlistTracks.style.display = "none"
    this.playlistsList.style.display = "block"
    this.updatePlaylistsList()
  }

  showAddToPlaylistModal() {
    if (!this.currentPlaylist) return

    this.availableTracksList.innerHTML = ""
    this.selectedTracks.clear()

    for (const track of this.tracks) {
      if (!this.currentPlaylist.trackIds.includes(track.id)) {
        const trackElement = document.createElement("div")
        trackElement.className = "available-track-item"

        trackElement.innerHTML = `
                    <input type="checkbox" class="track-checkbox" data-track-id="${track.id}">
                    <div class="track-info">
                        <div class="track-title">${track.title}</div>
                        <div class="track-artist">${track.artist}</div>
                    </div>
                `

        const checkbox = trackElement.querySelector(".track-checkbox")
        checkbox.addEventListener("change", (e) => {
          if (e.target.checked) {
            this.selectedTracks.add(track.id)
            trackElement.classList.add("selected")
          } else {
            this.selectedTracks.delete(track.id)
            trackElement.classList.remove("selected")
          }
        })

        this.availableTracksList.appendChild(trackElement)
      }
    }

    this.addToPlaylistModal.classList.add("show")
  }

  hideAddToPlaylistModal() {
    this.addToPlaylistModal.classList.remove("show")
    this.selectedTracks.clear()
  }

  async saveAddToPlaylist() {
    if (!this.currentPlaylist || this.selectedTracks.size === 0) return

    for (const trackId of this.selectedTracks) {
      this.currentPlaylist.trackIds.push(trackId)
    }

    await this.saveData()
    this.updateTrackList()
    this.hideAddToPlaylistModal()
  }

  async removeFromPlaylist(index) {
    if (!this.currentPlaylist) return

    this.currentPlaylist.trackIds.splice(index, 1)

    if (index <= this.currentTrackIndex) {
      this.currentTrackIndex = Math.max(0, this.currentTrackIndex - 1)
    }

    await this.saveData()
    this.updateTrackList()
  }

  // Редактирование треков
  showEditModal(track, index) {
    this.currentEditingTrack = track
    this.currentEditingTrackIndex = index

    this.editTitle.value = track.title
    this.editArtist.value = track.artist

    if (track.cover) {
      this.coverPreview.innerHTML = `<img src="${track.cover}" alt="Cover">`
    } else {
      this.coverPreview.innerHTML = '<i class="fas fa-music"></i>'
    }

    this.editModal.classList.add("show")
  }

  hideEditModal() {
    this.editModal.classList.remove("show")
    this.currentEditingTrack = null
    this.currentEditingTrackIndex = null
  }

  async saveTrackEdit() {
    if (this.currentEditingTrack) {
      this.currentEditingTrack.title = this.editTitle.value.trim() || "Без названия"
      this.currentEditingTrack.artist = this.editArtist.value.trim() || "Неизвестный исполнитель"

      this.updateTrackList()
      this.updateCurrentTrackInfo()
      await this.saveData()
      this.hideEditModal()
    }
  }

  async deleteTrack(index) {
    if (confirm("Вы уверены, что хотите удалить этот трек?")) {
      const track = this.tracks[index]

      // Удаляем файлы из IndexedDB
      if (track.audioId) {
        await this.deleteFileFromIndexedDB(track.audioId, "audioFiles")
      }
      if (track.coverId) {
        await this.deleteFileFromIndexedDB(track.coverId, "images")
      }

      // Удаляем трек из всех плейлистов
      this.playlists.forEach((playlist) => {
        const trackIndex = playlist.trackIds.indexOf(track.id)
        if (trackIndex > -1) {
          playlist.trackIds.splice(trackIndex, 1)
        }
      })

      // Удаляем трек из основного списка
      this.tracks.splice(index, 1)

      // Корректируем текущий индекс
      if (index <= this.currentTrackIndex) {
        this.currentTrackIndex = Math.max(0, this.currentTrackIndex - 1)
      }

      await this.saveData()
      this.updateTrackList()
      this.updateCurrentTrackInfo()
    }
  }

  // Сброс данных
  showResetConfirmModal() {
    this.resetConfirmModal.classList.add("show")
  }

  hideResetConfirmModal() {
    this.resetConfirmModal.classList.remove("show")
  }

  async confirmReset() {
    try {
      // Очищаем IndexedDB
      const audioTransaction = this.db.transaction(["audioFiles"], "readwrite")
      const audioStore = audioTransaction.objectStore("audioFiles")
      await audioStore.clear()

      const imageTransaction = this.db.transaction(["images"], "readwrite")
      const imageStore = imageTransaction.objectStore("images")
      await imageStore.clear()

      // Очищаем localStorage
      localStorage.removeItem("musicPlayerTracks")
      localStorage.removeItem("musicPlayerPlaylists")
      localStorage.removeItem("musicPlayerSettings")

      // Сброс состояния приложения
      this.tracks = []
      this.playlists = []
      this.currentTrackIndex = 0
      this.currentPlaylist = null
      this.isPlaying = false

      // Остановка аудио
      this.audio.pause()
      this.audio.src = ""

      // Обновление интерфейса
      this.pause()
      this.updateTrackList()
      this.updatePlaylistsList()
      this.updateCurrentTrackInfo()
      this.backToPlaylists()
      this.switchToTracksView()

      this.hideResetConfirmModal()

      alert("Все данные успешно удалены!")
    } catch (error) {
      console.error("Ошибка при сбросе данных:", error)
      alert("Произошла ошибка при удалении данных")
    }
  }

  // Утилиты
  getCurrentTrackList() {
    if (this.currentPlaylist) {
      return this.currentPlaylist.trackIds.map((id) => this.tracks.find((track) => track.id === id)).filter(Boolean)
    }
    return this.tracks
  }

  formatTime(seconds) {
    if (isNaN(seconds)) return "0:00"

    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.floor(seconds % 60)
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`
  }

  // Сохранение и загрузка данных
  async saveData() {
    try {
      // Сохраняем треки (без blob URL)
      const tracksData = this.tracks.map((track) => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        duration: track.duration,
        audioId: track.audioId,
        coverId: track.coverId,
      }))

      localStorage.setItem("musicPlayerTracks", JSON.stringify(tracksData))
      localStorage.setItem("musicPlayerPlaylists", JSON.stringify(this.playlists))

      // Сохраняем настройки
      const settings = {
        volume: this.volumeSlider.value,
        isShuffled: this.isShuffled,
        repeatMode: this.repeatMode,
      }
      localStorage.setItem("musicPlayerSettings", JSON.stringify(settings))
    } catch (error) {
      console.error("Ошибка при сохранении данных:", error)
    }
  }

  async loadData() {
    try {
      // Загружаем треки
      const savedTracks = localStorage.getItem("musicPlayerTracks")
      if (savedTracks) {
        const tracksData = JSON.parse(savedTracks)

        for (const trackData of tracksData) {
          if (trackData.audioId) {
            const url = await this.getFileFromIndexedDB(trackData.audioId, "audioFiles")
            if (url) {
              this.tracks.push({
                ...trackData,
                url: url,
                cover: null,
              })
            }
          }
        }
      }

      // Загружаем плейлисты
      const savedPlaylists = localStorage.getItem("musicPlayerPlaylists")
      if (savedPlaylists) {
        this.playlists = JSON.parse(savedPlaylists)
      }

      // Загружаем настройки
      const savedSettings = localStorage.getItem("musicPlayerSettings")
      if (savedSettings) {
        const settings = JSON.parse(savedSettings)
        this.volumeSlider.value = settings.volume || 70
        this.isShuffled = settings.isShuffled || false
        this.repeatMode = settings.repeatMode || 0

        // Применяем настройки
        this.setVolume()
        this.shuffleBtn.classList.toggle("active", this.isShuffled)
        this.repeatBtn.classList.toggle("active", this.repeatMode > 0)

        const icons = ["fa-repeat", "fa-repeat", "fa-repeat-1"]
        this.repeatBtn.innerHTML = `<i class="fas ${icons[this.repeatMode]}"></i>`
      }

      // Обновляем интерфейс
      this.updateTrackList()
      this.updatePlaylistsList()
    } catch (error) {
      console.error("Ошибка при загрузке данных:", error)
    }
  }

  // Регистрация Service Worker
  async registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js")
        console.log("Service Worker зарегистрирован:", registration)

        // Запрашиваем разрешение на уведомления
        if ("Notification" in window && Notification.permission === "default") {
          await Notification.requestPermission()
        }
      } catch (error) {
        console.error("Ошибка регистрации Service Worker:", error)
      }
    }
  }

  // Обработка изменения видимости страницы
  handleVisibilityChange() {
    if (document.hidden && this.isPlaying) {
      this.enterBackgroundMode()
    } else if (!document.hidden && this.isBackground) {
      this.exitBackgroundMode()
    }
  }

  // Вход в фоновый режим
  async enterBackgroundMode() {
    this.isBackground = true

    // Показываем уведомление
    this.showBackgroundNotification()

    // Создаем мини-плеер
    this.createMiniPlayer()

    // Обновляем Media Session
    this.updateMediaSession()

    // Запрашиваем Wake Lock для предотвращения засыпания
    try {
      if ("wakeLock" in navigator) {
        this.wakeLock = await navigator.wakeLock.request("screen")
      }
    } catch (error) {
      console.log("Wake Lock не поддерживается:", error)
    }

    // Отправляем сообщение Service Worker
    this.sendMessageToServiceWorker({
      type: "PLAYBACK_STATE_CHANGED",
      data: {
        isPlaying: this.isPlaying,
        position: this.audio.currentTime,
        duration: this.audio.duration,
      },
    })
  }

  // Выход из фонового режима
  exitBackgroundMode() {
    this.isBackground = false

    // Скрываем уведомление и мини-плеер
    this.hideBackgroundNotification()
    this.removeMiniPlayer()

    // Освобождаем Wake Lock
    if (this.wakeLock) {
      this.wakeLock.release()
      this.wakeLock = null
    }
  }

  // Показ уведомления о фоновом режиме
  showBackgroundNotification() {
    if (this.backgroundNotification) {
      this.backgroundNotification.classList.add("show")

      // Автоматически скрываем через 5 секунд
      setTimeout(() => {
        this.hideBackgroundNotification()
      }, 5000)
    }
  }

  // Скрытие уведомления
  hideBackgroundNotification() {
    if (this.backgroundNotification) {
      this.backgroundNotification.classList.remove("show")
    }
  }

  // Создание мини-плеера
  createMiniPlayer() {
    if (this.miniPlayer) return

    this.miniPlayer = document.createElement("div")
    this.miniPlayer.className = "mini-player show"

    const currentTrack = this.getCurrentTrackList()[this.currentTrackIndex]
    if (!currentTrack) return

    this.miniPlayer.innerHTML = `
      <div class="track-cover">
        ${currentTrack.cover ? `<img src="${currentTrack.cover}" alt="Cover">` : '<i class="fas fa-music"></i>'}
      </div>
      <div class="track-info">
        <div class="track-title">${currentTrack.title}</div>
        <div class="track-artist">${currentTrack.artist}</div>
      </div>
      <div class="mini-controls">
        <button class="control-btn mini-prev-btn">
          <i class="fas fa-step-backward"></i>
        </button>
        <button class="control-btn play-btn mini-play-btn">
          <i class="fas ${this.isPlaying ? "fa-pause" : "fa-play"}"></i>
        </button>
        <button class="control-btn mini-next-btn">
          <i class="fas fa-step-forward"></i>
        </button>
        <button class="control-btn mini-close-btn">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `

    // События для мини-плеера
    this.miniPlayer.querySelector(".mini-prev-btn").addEventListener("click", () => this.previousTrack())
    this.miniPlayer.querySelector(".mini-play-btn").addEventListener("click", () => this.togglePlay())
    this.miniPlayer.querySelector(".mini-next-btn").addEventListener("click", () => this.nextTrack())
    this.miniPlayer.querySelector(".mini-close-btn").addEventListener("click", () => this.exitBackgroundMode())

    document.body.appendChild(this.miniPlayer)
  }

  // Удаление мини-плеера
  removeMiniPlayer() {
    if (this.miniPlayer) {
      this.miniPlayer.remove()
      this.miniPlayer = null
    }
  }

  // Обновление мини-плеера
  updateMiniPlayer() {
    if (!this.miniPlayer) return

    const currentTrack = this.getCurrentTrackList()[this.currentTrackIndex]
    if (!currentTrack) return

    const coverElement = this.miniPlayer.querySelector(".track-cover")
    const titleElement = this.miniPlayer.querySelector(".track-title")
    const artistElement = this.miniPlayer.querySelector(".track-artist")
    const playButton = this.miniPlayer.querySelector(".mini-play-btn")

    if (currentTrack.cover) {
      coverElement.innerHTML = `<img src="${currentTrack.cover}" alt="Cover">`
    } else {
      coverElement.innerHTML = '<i class="fas fa-music"></i>'
    }

    titleElement.textContent = currentTrack.title
    artistElement.textContent = currentTrack.artist
    playButton.innerHTML = `<i class="fas ${this.isPlaying ? "fa-pause" : "fa-play"}"></i>`
  }

  // Обновление Media Session
  updateMediaSession() {
    const currentTrack = this.getCurrentTrackList()[this.currentTrackIndex]
    if (!currentTrack) return

    const trackData = {
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: "Мой плейлист",
      artwork: currentTrack.cover,
    }

    this.sendMessageToServiceWorker({
      type: "TRACK_CHANGED",
      data: trackData,
    })
  }

  // Отправка сообщения Service Worker
  sendMessageToServiceWorker(message) {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(message)
    }
  }

  // Обработка сообщений от Service Worker
  handleServiceWorkerMessage(event) {
    const { type, data } = event.data

    switch (type) {
      case "PLAY":
        if (!this.isPlaying) this.play()
        break
      case "PAUSE":
        if (this.isPlaying) this.pause()
        break
      case "PREVIOUS":
        this.previousTrack()
        break
      case "NEXT":
        this.nextTrack()
        break
      case "SEEK":
        this.audio.currentTime += data.offset
        break
      case "SEEK_TO":
        this.audio.currentTime = data.time
        break
    }
  }

  // Показ уведомления о треке
  showTrackNotification(track) {
    if ("Notification" in window && Notification.permission === "granted" && this.isBackground) {
      const notification = new Notification(`Сейчас играет: ${track.title}`, {
        body: track.artist,
        icon: track.cover || "/favicon.ico",
        badge: "/favicon.ico",
        tag: "music-player-track",
        silent: true,
        requireInteraction: false,
      })

      // Автоматически закрываем уведомление через 3 секунды
      setTimeout(() => notification.close(), 3000)

      notification.onclick = () => {
        window.focus()
        notification.close()
      }
    }
  }

  async handleFolderSelect(e) {
    const files = Array.from(e.target.files)
    const audioFiles = files.filter((file) => file.type.startsWith("audio/"))

    if (audioFiles.length > 0) {
      await this.processAudioFilesWithProgress(audioFiles)
    }

    // Очищаем input
    this.folderInput.value = ""
  }

  async handleDroppedItems(items) {
    const files = []

    for (const item of items) {
      if (item.kind === "file") {
        const entry = item.webkitGetAsEntry()
        if (entry) {
          if (entry.isDirectory) {
            await this.readDirectory(entry, files)
          } else if (entry.isFile) {
            const file = item.getAsFile()
            if (file && file.type.startsWith("audio/")) {
              files.push(file)
            }
          }
        }
      }
    }

    if (files.length > 0) {
      await this.processAudioFilesWithProgress(files)
    }
  }

  async readDirectory(directoryEntry, files) {
    const reader = directoryEntry.createReader()

    return new Promise((resolve) => {
      const readEntries = async () => {
        reader.readEntries(async (entries) => {
          if (entries.length === 0) {
            resolve()
            return
          }

          for (const entry of entries) {
            if (entry.isFile) {
              const file = await this.getFileFromEntry(entry)
              if (file && file.type.startsWith("audio/")) {
                files.push(file)
              }
            } else if (entry.isDirectory) {
              await this.readDirectory(entry, files)
            }
          }

          readEntries()
        })
      }

      readEntries()
    })
  }

  getFileFromEntry(fileEntry) {
    return new Promise((resolve) => {
      fileEntry.file(resolve)
    })
  }

  async processAudioFilesWithProgress(files) {
    if (files.length === 0) return

    this.showUploadProgress()

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const progress = ((i + 1) / files.length) * 100

      this.updateUploadProgress(progress, `Обработка ${i + 1} из ${files.length}: ${file.name}`)

      try {
        const audioId = await this.saveFileToIndexedDB(file, "audioFiles")
        const url = await this.getFileFromIndexedDB(audioId, "audioFiles")

        const track = {
          id: Date.now() + Math.random(),
          title: file.name.replace(/\.[^/.]+$/, ""),
          artist: "Неизвестный исполнитель",
          duration: "0:00",
          audioId: audioId,
          url: url,
          cover: null,
          coverId: null,
        }

        this.tracks.push(track)

        // Получаем длительность трека
        const audio = new Audio(track.url)
        audio.addEventListener("loadedmetadata", () => {
          track.duration = this.formatTime(audio.duration)
          this.updateTrackList()
          this.saveData()
        })
      } catch (error) {
        console.error("Ошибка при добавлении файла:", file.name, error)
      }
    }

    this.hideUploadProgress()
    this.updateTrackList()
    this.updateDropZoneVisibility()
    await this.saveData()
  }

  showUploadProgress() {
    this.uploadProgress.classList.add("show")
  }

  hideUploadProgress() {
    this.uploadProgress.classList.remove("show")
  }

  updateUploadProgress(percent, status) {
    this.uploadProgressBar.style.width = percent + "%"
    this.uploadStatus.textContent = status
  }

  updateDropZoneVisibility() {
    if (this.tracks.length > 0) {
      this.dropZone.classList.add("has-tracks")
    } else {
      this.dropZone.classList.remove("has-tracks")
    }
  }
}

// Инициализация плеера при загрузке страницы
document.addEventListener("DOMContentLoaded", () => {
  new MusicPlayer()
})
