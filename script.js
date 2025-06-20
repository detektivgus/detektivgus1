class MusicPlayerDB {
  constructor() {
    this.dbName = "MusicPlayerDB"
    this.dbVersion = 1
    this.db = null
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = event.target.result

        // Создаем хранилище для треков
        if (!db.objectStoreNames.contains("tracks")) {
          const trackStore = db.createObjectStore("tracks", { keyPath: "id" })
          trackStore.createIndex("title", "title", { unique: false })
          trackStore.createIndex("artist", "artist", { unique: false })
        }

        // Создаем хранилище для файлов
        if (!db.objectStoreNames.contains("files")) {
          const fileStore = db.createObjectStore("files", { keyPath: "id" })
        }
      }
    })
  }

  async saveTrack(track) {
    const transaction = this.db.transaction(["tracks"], "readwrite")
    const store = transaction.objectStore("tracks")
    return store.put(track)
  }

  async saveFile(id, file) {
    const transaction = this.db.transaction(["files"], "readwrite")
    const store = transaction.objectStore("files")
    return store.put({ id, file })
  }

  async getTrack(id) {
    const transaction = this.db.transaction(["tracks"], "readonly")
    const store = transaction.objectStore("tracks")
    return new Promise((resolve, reject) => {
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async getFile(id) {
    const transaction = this.db.transaction(["files"], "readonly")
    const store = transaction.objectStore("files")
    return new Promise((resolve, reject) => {
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result?.file)
      request.onerror = () => reject(request.error)
    })
  }

  async getAllTracks() {
    const transaction = this.db.transaction(["tracks"], "readonly")
    const store = transaction.objectStore("tracks")
    return new Promise((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async deleteTrack(id) {
    const transaction = this.db.transaction(["tracks"], "readwrite")
    const store = transaction.objectStore("tracks")
    return store.delete(id)
  }

  async deleteFile(id) {
    const transaction = this.db.transaction(["files"], "readwrite")
    const store = transaction.objectStore("files")
    return store.delete(id)
  }

  async clearAll() {
    const transaction = this.db.transaction(["tracks", "files"], "readwrite")
    const trackStore = transaction.objectStore("tracks")
    const fileStore = transaction.objectStore("files")
    await trackStore.clear()
    await fileStore.clear()
  }
}

class MusicPlayer {
  constructor() {
    this.db = new MusicPlayerDB()
    this.tracks = []
    this.currentTrackIndex = 0
    this.isPlaying = false
    this.isShuffled = false
    this.repeatMode = 0 // 0: no repeat, 1: repeat all, 2: repeat one
    this.audio = document.getElementById("audioPlayer")
    this.audioContext = null
    this.analyser = null
    this.dataArray = null
    this.currentEditingTrack = null

    this.init()
  }

  async init() {
    try {
      await this.db.init()
      this.initializeElements()
      this.bindEvents()
      this.initializeVisualizer()
      await this.loadSavedTracks()
      this.showNotification("Плеер загружен", "success")
    } catch (error) {
      console.error("Ошибка инициализации:", error)
      this.showNotification("Ошибка загрузки плеера", "error")
    }
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

    // Списки и элементы
    this.trackList = document.getElementById("trackList")
    this.visualizer = document.getElementById("visualizer")

    // Файловые инпуты
    this.musicFileInput = document.getElementById("musicFileInput")
    this.imageFileInput = document.getElementById("imageFileInput")
    this.importFileInput = document.getElementById("importFileInput")
    this.addMusicBtn = document.getElementById("addMusicBtn")
    this.exportBtn = document.getElementById("exportBtn")
    this.importBtn = document.getElementById("importBtn")

    // Модальное окно
    this.editModal = document.getElementById("editTrackModal")
    this.coverPreview = document.getElementById("coverPreview")
    this.editTitle = document.getElementById("editTitle")
    this.editArtist = document.getElementById("editArtist")
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

    // Файловые инпуты
    this.addMusicBtn.addEventListener("click", () => this.musicFileInput.click())
    this.exportBtn.addEventListener("click", () => this.exportTracks())
    this.importBtn.addEventListener("click", () => this.importFileInput.click())
    this.musicFileInput.addEventListener("change", (e) => this.handleMusicFiles(e))
    this.imageFileInput.addEventListener("change", (e) => this.handleImageFile(e))
    this.importFileInput.addEventListener("change", (e) => this.handleImportFile(e))

    // Модальное окно
    document.getElementById("closeEditModal").addEventListener("click", () => this.hideEditModal())
    document.getElementById("cancelEditBtn").addEventListener("click", () => this.hideEditModal())
    document.getElementById("saveEditBtn").addEventListener("click", () => this.saveTrackEdit())
    document.getElementById("changeCoverBtn").addEventListener("click", () => this.imageFileInput.click())

    // Закрытие модального окна по клику вне его
    this.editModal.addEventListener("click", (e) => {
      if (e.target === this.editModal) {
        this.hideEditModal()
      }
    })

    // Drag & Drop для всего окна
    document.addEventListener("dragover", (e) => {
      e.preventDefault()
    })

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
  }

  initializeVisualizer() {
    this.canvas = this.visualizer
    this.ctx = this.canvas.getContext("2d")

    // Устанавливаем размер canvas
    this.resizeCanvas()
    window.addEventListener("resize", () => this.resizeCanvas())

    // Запускаем анимацию
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

          // Создаем волновой эффект
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
      // Статичная визуализация когда музыка не играет
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

  async handleMusicFiles(e) {
    const files = Array.from(e.target.files)
    await this.processAudioFiles(files)
    e.target.value = "" // Сбрасываем значение input
  }

  async processAudioFiles(files) {
    this.showNotification(`Добавление ${files.length} файлов...`)

    for (const file of files) {
      try {
        const track = {
          id: Date.now() + Math.random(),
          title: file.name.replace(/\.[^/.]+$/, ""),
          artist: "Неизвестный исполнитель",
          duration: "0:00",
          cover: null,
          fileId: `audio_${Date.now()}_${Math.random()}`,
        }

        // Сохраняем файл в IndexedDB
        await this.db.saveFile(track.fileId, file)

        // Получаем длительность трека
        const audioUrl = URL.createObjectURL(file)
        const audio = new Audio(audioUrl)

        await new Promise((resolve) => {
          audio.addEventListener("loadedmetadata", () => {
            track.duration = this.formatTime(audio.duration)
            URL.revokeObjectURL(audioUrl)
            resolve()
          })
        })

        // Сохраняем трек
        await this.db.saveTrack(track)
        this.tracks.push(track)
      } catch (error) {
        console.error("Ошибка добавления файла:", error)
      }
    }

    this.updateTrackList()
    this.showNotification(`Добавлено ${files.length} треков`, "success")
  }

  async handleImageFile(e) {
    const file = e.target.files[0]
    if (file && this.currentEditingTrack) {
      const reader = new FileReader()
      reader.onload = (e) => {
        this.currentEditingTrack.cover = e.target.result
        this.coverPreview.innerHTML = `<img src="${e.target.result}" alt="Cover">`
      }
      reader.readAsDataURL(file)
    }
    e.target.value = ""
  }

  async handleImportFile(e) {
    const file = e.target.files[0]
    if (file) {
      try {
        const text = await file.text()
        const data = JSON.parse(text)

        if (data.tracks && Array.isArray(data.tracks)) {
          await this.importTracks(data.tracks)
          this.showNotification("Треки импортированы", "success")
        } else {
          this.showNotification("Неверный формат файла", "error")
        }
      } catch (error) {
        console.error("Ошибка импорта:", error)
        this.showNotification("Ошибка импорта", "error")
      }
    }
    e.target.value = ""
  }

  async importTracks(tracksData) {
    for (const trackData of tracksData) {
      if (trackData.id && trackData.title) {
        await this.db.saveTrack(trackData)
      }
    }
    await this.loadSavedTracks()
  }

  async exportTracks() {
    try {
      const data = {
        version: "1.0",
        exported: new Date().toISOString(),
        tracks: this.tracks,
      }

      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      })

      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `music-player-export-${new Date().toISOString().split("T")[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      this.showNotification("Данные экспортированы", "success")
    } catch (error) {
      console.error("Ошибка экспорта:", error)
      this.showNotification("Ошибка экспорта", "error")
    }
  }

  // Управление воспроизведением
  async togglePlay() {
    if (this.tracks.length === 0) {
      this.showNotification("Добавьте музыку для воспроизведения")
      return
    }

    if (this.isPlaying) {
      this.pause()
    } else {
      await this.play()
    }
  }

  async play() {
    if (this.tracks.length === 0) return

    const currentTrack = this.tracks[this.currentTrackIndex]
    if (!currentTrack) return

    try {
      // Получаем файл из IndexedDB
      const file = await this.db.getFile(currentTrack.fileId)
      if (!file) {
        this.showNotification("Файл не найден", "error")
        return
      }

      const url = URL.createObjectURL(file)

      if (this.audio.src !== url) {
        if (this.audio.src) {
          URL.revokeObjectURL(this.audio.src)
        }
        this.audio.src = url
      }

      this.setupAudioContext()

      await this.audio.play()
      this.isPlaying = true
      this.playBtn.innerHTML = '<i class="fas fa-pause"></i>'
      this.updateCurrentTrackInfo()
      this.updateTrackList()
    } catch (error) {
      console.error("Ошибка воспроизведения:", error)
      this.showNotification("Ошибка воспроизведения", "error")
    }
  }

  pause() {
    this.audio.pause()
    this.isPlaying = false
    this.playBtn.innerHTML = '<i class="fas fa-play"></i>'
  }

  async previousTrack() {
    if (this.tracks.length === 0) return

    this.currentTrackIndex = (this.currentTrackIndex - 1 + this.tracks.length) % this.tracks.length
    await this.play()
  }

  async nextTrack() {
    if (this.tracks.length === 0) return

    if (this.isShuffled) {
      this.currentTrackIndex = Math.floor(Math.random() * this.tracks.length)
    } else {
      this.currentTrackIndex = (this.currentTrackIndex + 1) % this.tracks.length
    }
    await this.play()
  }

  async handleTrackEnd() {
    if (this.repeatMode === 2) {
      // Repeat one
      await this.play()
    } else if (this.repeatMode === 1) {
      // Repeat all
      await this.nextTrack()
    } else {
      if (this.currentTrackIndex < this.tracks.length - 1) {
        await this.nextTrack()
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
    localStorage.setItem("musicPlayerVolume", this.volumeSlider.value)
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
  }

  updateDuration() {
    this.totalTime.textContent = this.formatTime(this.audio.duration)
  }

  updateCurrentTrackInfo() {
    const currentTrack = this.tracks[this.currentTrackIndex]

    if (currentTrack) {
      this.currentTitle.textContent = currentTrack.title
      this.currentArtist.textContent = currentTrack.artist
      this.trackTitleLarge.textContent = currentTrack.title
      this.trackArtistLarge.textContent = currentTrack.artist

      if (currentTrack.cover) {
        this.currentCover.innerHTML = `<img src="${currentTrack.cover}" alt="Cover">`
      } else {
        this.currentCover.innerHTML = '<i class="fas fa-music"></i>'
      }
    }
  }

  updateTrackList() {
    this.trackList.innerHTML = ""

    if (this.tracks.length === 0) {
      this.trackList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-music"></i>
                    <p>Перетащите музыкальные файлы сюда<br>или нажмите "Добавить"</p>
                </div>
            `
      return
    }

    this.tracks.forEach((track, index) => {
      const trackElement = document.createElement("div")
      trackElement.className = "track-item"
      if (index === this.currentTrackIndex && this.isPlaying) {
        trackElement.classList.add("playing")
      }

      trackElement.innerHTML = `
                <div class="track-cover">
                    ${track.cover ? `<img src="${track.cover}" alt="Cover">` : '<i class="fas fa-music"></i>'}
                </div>
                <div class="track-info">
                    <div class="track-title">${track.title}</div>
                    <div class="track-artist">${track.artist}</div>
                </div>
                <div class="track-duration">${track.duration}</div>
                <div class="track-actions">
                    <button class="track-action-btn" onclick="player.showEditModal(${index})" title="Редактировать">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="track-action-btn" onclick="player.deleteTrack(${index})" title="Удалить">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `

      trackElement.addEventListener("click", async (e) => {
        if (!e.target.closest(".track-actions")) {
          this.currentTrackIndex = index
          await this.play()
        }
      })

      this.trackList.appendChild(trackElement)
    })
  }

  // Модальное окно редактирования
  showEditModal(index) {
    const track = this.tracks[index]
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

      // Сохраняем изменения в IndexedDB
      await this.db.saveTrack(this.currentEditingTrack)

      this.updateTrackList()
      this.updateCurrentTrackInfo()
      this.hideEditModal()
      this.showNotification("Трек обновлен", "success")
    }
  }

  async deleteTrack(index) {
    if (confirm("Удалить этот трек?")) {
      const track = this.tracks[index]

      try {
        // Удаляем из IndexedDB
        await this.db.deleteTrack(track.id)
        await this.db.deleteFile(track.fileId)

        // Удаляем из локального массива
        this.tracks.splice(index, 1)

        // Корректируем текущий индекс
        if (this.currentTrackIndex >= index) {
          this.currentTrackIndex = Math.max(0, this.currentTrackIndex - 1)
        }

        // Если удалили все треки
        if (this.tracks.length === 0) {
          this.pause()
          this.currentTrackIndex = 0
          this.trackTitleLarge.textContent = "Выберите трек"
          this.trackArtistLarge.textContent = "для воспроизведения"
          this.currentTitle.textContent = "Название трека"
          this.currentArtist.textContent = "Исполнитель"
          this.currentCover.innerHTML = '<i class="fas fa-music"></i>'
        }

        this.updateTrackList()
        this.showNotification("Трек удален", "success")
      } catch (error) {
        console.error("Ошибка удаления трека:", error)
        this.showNotification("Ошибка удаления", "error")
      }
    }
  }

  // Сохранение и загрузка
  async loadSavedTracks() {
    try {
      this.tracks = await this.db.getAllTracks()
      this.updateTrackList()

      // Восстанавливаем громкость
      const savedVolume = localStorage.getItem("musicPlayerVolume")
      if (savedVolume) {
        this.volumeSlider.value = savedVolume
        this.setVolume()
      }
    } catch (error) {
      console.error("Ошибка загрузки треков:", error)
    }
  }

  // Уведомления
  showNotification(message, type = "info") {
    const notification = document.createElement("div")
    notification.className = `notification ${type}`
    notification.textContent = message

    document.body.appendChild(notification)

    // Показываем уведомление
    setTimeout(() => notification.classList.add("show"), 100)

    // Скрываем через 3 секунды
    setTimeout(() => {
      notification.classList.remove("show")
      setTimeout(() => document.body.removeChild(notification), 300)
    }, 3000)
  }

  // Утилиты
  formatTime(seconds) {
    if (isNaN(seconds)) return "0:00"

    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.floor(seconds % 60)
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`
  }
}

// Глобальная переменная для доступа из HTML
let player

// Инициализация плеера при загрузке страницы
document.addEventListener("DOMContentLoaded", () => {
  player = new MusicPlayer()
})
