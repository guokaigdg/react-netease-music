import React, { useEffect, useRef, useCallback } from 'react'
import { observer } from 'mobx-react-lite'
import { useStores } from '@/stores'
import { useEventListener } from '@/hooks'
import { fetchUrl } from '@/api'

// Audio组件，常驻页面，控制音乐的播放
const Audio = observer(function Audio() {
  const audioRef = useRef()

  const { playerStore } = useStores()

  // AudioContext
  const ctxRef = useRef()
  // AnalyserNode
  const analyserRef = useRef()
  // SourceNode
  const sourceRef = useRef()
  // 频率数组
  const dataArrayRef = useRef()

  useEventListener(
    'play',
    () => {
      console.log('播放')
    },
    audioRef
  )
  useEventListener(
    'playing',
    () => {
      console.log('播放ing')
    },
    audioRef
  )
  useEventListener(
    'pause',
    () => {
      console.log('暂停')
    },
    audioRef
  )
  // 当浏览器正在下载指定的音频/视频时，会发生 progress 事件
  useEventListener(
    'progress',
    () => {
      console.log('缓冲下载中，可用于缓存效果')
      if (audioRef.current.buffered.length > 0) {
        const bufferedTime = audioRef.current.buffered.end(0) // 已缓存区域的时间
        playerStore.setBufferedTime(bufferedTime)
      }
    },
    audioRef
  )
  // 当浏览器能够开始播放指定的音频/视频时，发生 canplay 事件
  useEventListener(
    'canplay',
    () => {
      console.log('canplay', audioRef.current.duration)
      playerStore.setTotalTime(audioRef.current.duration)
    },
    audioRef
  )
  // 浏览器预计能够在不停下来进行缓冲的情况下持续播放指定的音频/视频时，会发生 canplaythrough 事件
  useEventListener(
    'canplaythrough',
    () => {
      console.log('canplaythrough')
      // 每次改变当前的播放时间，都会触发这个事件，并重新检测播放状态
      playerStore.isPlaying ? audioRef.current.play() : audioRef.current.pause()
    },
    audioRef
  )
  useEventListener(
    'timeupdate',
    () => {
      // console.log('currentTime:', audioRef.current.currentTime)
      playerStore.setCurrentTime(audioRef.current.currentTime)
    },
    audioRef
  )
  useEventListener(
    'ended',
    () => {
      console.log('---------------ended---------------')
      // 单曲循环在audio标签上设置了loop模式，其他播放模式直接下一首
      if (playerStore.playMode !== 'single') {
        playerStore.nextSong()
      }
    },
    audioRef
  )

  useEventListener(
    'stalled',
    () => {
      console.log('当浏览器尝试获取媒体数据，但数据不可用时触发。')
    },
    audioRef
  )
  useEventListener(
    'seeked',
    () => {
      console.log('当用户已移动/跳跃到音频/视频中的新位置时触发。')
    },
    audioRef
  )
  useEventListener(
    'error',
    e => {
      console.log('歌曲播放出错')
      playerStore.currentDirection === 'prev' ? playerStore.prevSong() : playerStore.nextSong()
    },
    audioRef
  )

  const initAudio = useCallback(() => {
    // 创建Audio上下文
    ctxRef.current = new (window.AudioContext || window.webkitAudioContext)()

    // 创建AnalyserNode，用于获取音频的频率数据（FrequencyData）和时域数据（TimeDomainData）。从而实现音频的可视化。
    analyserRef.current = ctxRef.current.createAnalyser()
    //快速傅里叶变换的一个参数，2的幂次方，数字越大，得到的结果越精细。fftSize决定了frequencyData的长度，具体为fftSize的一半
    analyserRef.current.fftSize = 512

    // 设置SourceNode
    sourceRef.current = ctxRef.current.createMediaElementSource(audioRef.current)

    // 连接操作
    sourceRef.current.connect(analyserRef.current)
    analyserRef.current.connect(ctxRef.current.destination)

    // 获取频率数组
    // frequencyBinCount为fftSize值的一半. 该属性通常用于可视化的数据值的数量.
    dataArrayRef.current = new Uint8Array(analyserRef.current.frequencyBinCount)
    // getByteFrequencyData 更新操作，是对已有的数组元素进行赋值，而不是创建后返回新的数组
    analyserRef.current.getByteFrequencyData(dataArrayRef.current)

    playerStore.setAnalyser(analyserRef.current)
    playerStore.setDataArray(dataArrayRef.current)
    // eslint-disable-next-line
  }, [])

  useEffect(() => {
    // The AudioContext was not allowed to start. It must be resumed (or created) after a user gesture on the page.
    // 由于Chrome的策略，AudioContext无法在用户手势之前开始
    // 所以我把它放在了ctxRef.current为undefined以及isPlaying为true时，才初始化
    // 因为页面刚加载时isPlaying === false，只要它为true，那么肯定是经过了手势操作
    if (!ctxRef.current && playerStore.isPlaying) {
      initAudio()
    }
    // analyserRef.current.getByteFrequencyData(dataArrayRef.current)
    // playerStore.updateDataArray()

    // 控制播放
    // 点击播放按钮的时候，改变播放状态
    if (!playerStore.currentSongId) return
    playerStore.isPlaying ? audioRef.current.play() : audioRef.current.pause()

    // eslint-disable-next-line
  }, [playerStore.isPlaying])

  useEffect(() => {
    const requsetMusic = async () => {
      if (!playerStore.currentSongId) {
        // 当清空播放列表后，src仍是上一首的曲子，点击别的歌曲播放时，会播放零点几秒的上一首歌，才会切换
        // 所以需要将src置为空，但这会触发onError事件
        audioRef.current.src = ''
        return
      }
      // 不写crossOrigin="anonymous"，会有MediaElementAudioSource outputs zeroes due to CORS access restrictions
      // 写crossOrigin="anonymous"，如果直接用下面这个地址请求，但服务器端禁止了跨域，响应头没有access-control-allow-origin
      // audioRef.current.src = `https://music.163.com/song/media/outer/url?id=${playerStore.currentSongId}.mp3`
      // audioRef.current.play()

      // 从接口获取url，再播放，可以跨域
      console.log('请求开始', 'id', playerStore.currentSongId)
      const res = await fetchUrl(playerStore.currentSongId)
      if (res.data[0].url) {
        playerStore.setBufferedTime(0)
        audioRef.current.src = res.data[0].url
        // 将切换播放状态写在这里，防止暂停状态下，切换歌单播放时，会短暂播放上一首歌曲的问题
        playerStore.shouldPlay && !playerStore.isPlaying && playerStore.setIsPlaying(true)
      } else {
        playerStore.currentDirection === 'prev' ? playerStore.prevSong() : playerStore.nextSong()
      }
    }
    requsetMusic()
    // eslint-disable-next-line
  }, [playerStore.currentSongId])

  useEffect(() => {
    // 根据timeToPlay来设置当前播放时间
    if (playerStore.timeToPlay !== null) {
      audioRef.current.currentTime = playerStore.timeToPlay
      playerStore.setTimeToPlay(null)
    }
    // eslint-disable-next-line
  }, [playerStore.timeToPlay])

  useEffect(() => {
    if (!playerStore.currentSongId) return
    playerStore.getLyrics()
    // eslint-disable-next-line
  }, [playerStore.currentSongId])

  useEffect(() => {
    audioRef.current.volume = playerStore.volume
  }, [playerStore.volume])

  return (
    <audio
      ref={audioRef}
      preload="auto"
      crossOrigin="anonymous"
      loop={playerStore.playMode === 'single'}
    ></audio>
  )
})

export default React.memo(Audio)
