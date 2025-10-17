import { useState, useRef, useEffect } from 'react'
import './styles/App.css'

function App() {
  const [isConnected, setIsConnected] = useState(false)
  const [status, setStatus] = useState('Click Start to begin tutoring')
  const [transcript, setTranscript] = useState<string[]>([])
  
  const wsRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<AudioWorkletNode | null>(null)
  const audioQueueRef = useRef<Int16Array[]>([])
  const isPlayingRef = useRef(false)
  const currentAIMessageRef = useRef<number>(-1)

  // Starts session
  const startTutor = async () => {
    try {
      console.log('Starting tutor session...')
      setStatus('Initializing...')
      
      console.log('Creating audio context...')
      audioContextRef.current = new AudioContext({ sampleRate: 24000 })
      
      console.log('Requesting microphone access...')
      setStatus('Requesting microphone access...')
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        } 
      })
      mediaStreamRef.current = stream
      console.log('Microphone access granted')
      
      console.log('Connecting to WebSocket...')
      setStatus('Connecting to server...')
      const ws = new WebSocket('ws://localhost:8000/ws/tutor')
      wsRef.current = ws
      
      ws.onopen = async () => {
        console.log('WebSocket connected!')
        setIsConnected(true)
        setStatus('Connected! Start speaking...')
        
        const audioContext = audioContextRef.current!
        const source = audioContext.createMediaStreamSource(stream)
        
        // Audio worklet module to process input
        await audioContext.audioWorklet.addModule(
          'data:text/javascript,' + encodeURIComponent(`
            class AudioProcessor extends AudioWorkletProcessor {
              process(inputs, outputs, parameters) {
                const input = inputs[0];
                if (input.length > 0) {
                  const channelData = input[0];
                  this.port.postMessage(channelData);
                }
                return true;
              }
            }
            registerProcessor('audio-processor', AudioProcessor);
          `)
        )
        
        const workletNode = new AudioWorkletNode(audioContext, 'audio-processor')
        
        // Process audio
        workletNode.port.onmessage = (event) => {
          const float32Data = event.data
          const int16Data = new Int16Array(float32Data.length)
          
          // Convert float32 to int16
          for (let i = 0; i < float32Data.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Data[i]))
            int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
          }
          
          // Convert to base64
          const bytes = new Uint8Array(int16Data.buffer)
          let binary = ''
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i])
          }
          const base64Audio = btoa(binary)
          
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'audio',
              audio: base64Audio
            }))
          }
        }
        
        // Conn audio nodes
        source.connect(workletNode)
        workletNode.connect(audioContext.destination)
        processorRef.current = workletNode as any
      }
      
      // Handle inc messages from server
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data)
        
        if (message.type === 'audio') {
          playAudioChunk(message.audio)
        } 
        else if (message.type === 'ai_transcript') {
          updateAITranscript(message.text)
        } 
        else if (message.type === 'user_transcript') {
          addTranscript('You: ' + message.text, 'user')
          currentAIMessageRef.current = -1
        } 
        else if (message.type === 'speech_started') {
          setStatus('Listening...')
        } 
        else if (message.type === 'speech_stopped') {
          setStatus('Processing...')
        } 
        else if (message.type === 'error') {
          setStatus('Error: ' + message.error)
        }
      }
      
      // Handle WS errors
      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        setStatus('Connection error')
      }
      
      // Handle WS conn closed
      ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason)
        setIsConnected(false)
        setStatus('Disconnected')
      }
      
    } catch (error) {
      console.error('Error starting tutor:', error)
      setStatus('Error: Could not access microphone')
    }
  }

  const stopTutor = () => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }))
      wsRef.current.close()
      wsRef.current = null
    }
    
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }
    
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    
    setIsConnected(false)
    setStatus('Session ended')
  }

  // Add new msg to the transcript
  const addTranscript = (text: string, type: 'user' | 'ai') => {
    setTranscript(prev => {
      const newTranscript = [...prev, text]
      if (type === 'ai') {
        currentAIMessageRef.current = newTranscript.length - 1
      }
      return newTranscript
    })
  }

  // Update current AI msg with streaming text
  const updateAITranscript = (delta: string) => {
    if (currentAIMessageRef.current === -1) {
      addTranscript('AI: ' + delta, 'ai')
    } else {
      setTranscript(prev => {
        const newTranscript = [...prev]
        newTranscript[currentAIMessageRef.current] += delta
        return newTranscript
      })
    }
  }

  const playAudioChunk = (base64Audio: string) => {
    if (!audioContextRef.current) return

    try {
      const binaryString = atob(base64Audio)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      
      const int16Array = new Int16Array(bytes.buffer)
      audioQueueRef.current.push(int16Array)
      
      if (!isPlayingRef.current) {
        playNextInQueue()
      }
    } catch (error) {
      console.error('Error playing audio:', error)
    }
  }

  // Play next audio chunk in queue
  const playNextInQueue = () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false
      return
    }

    isPlayingRef.current = true
    const int16Array = audioQueueRef.current.shift()!
    
    if (!audioContextRef.current) return

    // Convert int16 to float32
    const float32Array = new Float32Array(int16Array.length)
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0
    }

    // Play audio
    const audioBuffer = audioContextRef.current.createBuffer(1, float32Array.length, 24000)
    audioBuffer.getChannelData(0).set(float32Array)

    const source = audioContextRef.current.createBufferSource()
    source.buffer = audioBuffer
    source.connect(audioContextRef.current.destination)
    source.onended = () => playNextInQueue()
    source.start()
  }

  useEffect(() => {
    return () => {
      stopTutor()
    }
  }, [])

  return (
    <div className="app-container">
      <h1 className="app-title">TalkTutor</h1>
      <p className="app-subtitle">Student Learning Hub Prototype</p>
      
      <button 
        onClick={isConnected ? stopTutor : startTutor}
        className={`session-button ${isConnected ? 'active' : 'inactive'}`}
      >
        {isConnected ? 'Stop Session' : 'Start Tutoring Session'}
      </button>
      
      <div className="status-box">
        Status: {status}
      </div>

      <div className="transcript-container">
        <h3 className="transcript-title">Transcript:</h3>
        
        {transcript.length === 0 ? (
          <p className="transcript-empty">
            Conversation will appear here...
          </p>
        ) : (
          transcript.map((line, index) => (
            <div 
              key={index} 
              className={`transcript-message ${line.startsWith('You:') ? 'user' : 'ai'}`}
            >
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default App