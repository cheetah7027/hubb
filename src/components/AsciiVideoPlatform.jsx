"use client";
import { useEffect, useRef, useState } from "react";
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

export default function AsciiVideoConverter() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [file, setFile] = useState(null);
  const [scale, setScale] = useState(0.12);
  const [fps, setFps] = useState(12);
  const [chars, setChars] = useState("@%#*+=-:. ");
  const [bgColor, setBgColor] = useState("#000000");
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [recordedChunks, setRecordedChunks] = useState([]);
  const [ffmpeg, setFfmpeg] = useState(null);
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [ffmpegLoading, setFfmpegLoading] = useState(true);
  const [isConverting, setIsConverting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const loadFFmpeg = async () => {
      try {
        setFfmpegLoading(true);
        const ff = new FFmpeg();
        
        // Use reliable CDN with fallback options
        const cdnOptions = [
          'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd',
          'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd'
        ];
        
        let loaded = false;
        for (const baseURL of cdnOptions) {
          try {
            console.log(`Attempting to load FFmpeg from: ${baseURL}`);
            await ff.load({
              coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
              wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
              workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript')
            });
            loaded = true;
            console.log(`FFmpeg loaded successfully from: ${baseURL}`);
            break;
          } catch (cdnError) {
            console.warn(`Failed to load from ${baseURL}:`, cdnError);
            continue;
          }
        }
        
        if (!loaded) {
          throw new Error('Failed to load FFmpeg from all CDN sources');
        }
        
        setFfmpeg(ff);
        setFfmpegReady(true);
      } catch (error) {
        console.error('Failed to load FFmpeg:', error);
        alert('Failed to load FFmpeg. Please refresh the page and try again.');
      } finally {
        setFfmpegLoading(false);
      }
    };
    loadFFmpeg();
  }, []);

  useEffect(() => {
    let ctx;
    let interval;
    if (file && videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      ctx = canvas.getContext("2d");

      video.addEventListener("play", () => {
        interval = setInterval(() => {
          if (video.paused || video.ended) return;
          const w = Math.floor(video.videoWidth * scale);
          const h = Math.floor(video.videoHeight * scale);
          canvas.width = w * 8;
          canvas.height = h * 12;
          
          // Apply background color
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          ctx.drawImage(video, 0, 0, w, h);
          const frame = ctx.getImageData(0, 0, w, h);
          
          // Clear and apply background again
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          ctx.font = "12px monospace";
          ctx.textBaseline = "top";
          
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const i = (y * w + x) * 4;
              const r = frame.data[i];
              const g = frame.data[i + 1];
              const b = frame.data[i + 2];
              const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
              const charIndex = Math.floor(brightness * (chars.length - 1));
              const char = chars[charIndex];
              ctx.fillStyle = `rgb(${r},${g},${b})`;
              ctx.fillText(char, x * 8, y * 12);
            }
          }
        }, 1000 / fps);
      });

      return () => clearInterval(interval);
    }
  }, [file, scale, fps, chars, bgColor]);

  // Fullscreen functionality
  const toggleFullscreen = async () => {
    if (!canvasRef.current) return;
    
    try {
      if (!isFullscreen) {
        if (canvasRef.current.requestFullscreen) {
          await canvasRef.current.requestFullscreen();
        } else if (canvasRef.current.webkitRequestFullscreen) {
          await canvasRef.current.webkitRequestFullscreen();
        } else if (canvasRef.current.mozRequestFullScreen) {
          await canvasRef.current.mozRequestFullScreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
          await document.mozCancelFullScreen();
        }
      }
    } catch (error) {
      console.error('Fullscreen error:', error);
    }
  };

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
    };
  }, []);

  const startRecording = () => {
    if (!canvasRef.current || !ffmpegReady) return;
    
    const stream = canvasRef.current.captureStream(fps);
    const recorder = new MediaRecorder(stream, { 
      mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') 
        ? 'video/webm;codecs=vp9' 
        : 'video/webm' 
    });
    
    const chunks = [];
    
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };
    
    recorder.onstop = async () => {
      setIsConverting(true);
      try {
        const blob = new Blob(chunks, { type: "video/webm" });
        console.log('WebM blob created, size:', blob.size);
        
        // Write WebM file to FFmpeg filesystem
        await ffmpeg.writeFile("input.webm", await fetchFile(blob));
        console.log('WebM file written to FFmpeg filesystem');
        
        // Convert WebM to MP4 with optimized settings
        await ffmpeg.exec([
          "-i", "input.webm",
          "-c:v", "libx264",
          "-preset", "medium",
          "-crf", "23",
          "-pix_fmt", "yuv420p",
          "-movflags", "+faststart",
          "output.mp4"
        ]);
        console.log('WebM to MP4 conversion completed');
        
        // Read the output file
        const data = await ffmpeg.readFile("output.mp4");
        console.log('MP4 file read, size:', data.length);
        
        // Create and trigger download
        const url = URL.createObjectURL(new Blob([data.buffer], { type: "video/mp4" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `ascii-video-${Date.now()}.mp4`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        
        // Cleanup
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
        
        // Clean up FFmpeg filesystem
        try {
          await ffmpeg.deleteFile("input.webm");
          await ffmpeg.deleteFile("output.mp4");
        } catch (cleanupError) {
          console.warn('Cleanup error:', cleanupError);
        }
        
        console.log('MP4 download triggered successfully');
      } catch (error) {
        console.error('Error during conversion:', error);
        alert(`Failed to convert video: ${error.message}. Please try again.`);
      } finally {
        setIsConverting(false);
      }
    };
    
    recorder.start(1000); // Collect data every second
    setMediaRecorder(recorder);
    setRecording(true);
    console.log('Recording started');
  };

  const stopRecording = () => {
    if (mediaRecorder && recording) {
      mediaRecorder.stop();
      setRecording(false);
      console.log('Recording stopped');
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-4">ASCII Video Converter</h1>

      <div className="mb-4">
        <label className="block mb-2 font-medium">Upload a video:</label>
        <input
          type="file"
          accept="video/*"
          onChange={(e) => {
            if (e.target.files[0]) {
              setFile(URL.createObjectURL(e.target.files[0]));
            }
          }}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block mb-1 font-medium">Characters (dark → light):</label>
          <input
            type="text"
            value={chars}
            onChange={(e) => setChars(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2"
          />
        </div>
        
        <div>
          <label className="block mb-1 font-medium">Background Color:</label>
          <input
            type="color"
            value={bgColor}
            onChange={(e) => setBgColor(e.target.value)}
            className="w-full h-10 border border-gray-300 rounded cursor-pointer"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block mb-1 font-medium">Scale (0.02 – 0.5): {scale}</label>
          <input
            type="range"
            min="0.02"
            max="0.5"
            step="0.01"
            value={scale}
            onChange={(e) => setScale(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>
        
        <div>
          <label className="block mb-1 font-medium">FPS (1–60):</label>
          <input
            type="number"
            value={fps}
            min="1"
            max="60"
            onChange={(e) => setFps(parseInt(e.target.value) || 1)}
            className="w-full border border-gray-300 rounded px-3 py-2"
          />
        </div>
      </div>

      <div className="flex gap-3 mb-6 flex-wrap">
        {file && (
          <button
            onClick={() => videoRef.current?.play()}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
          >
            Play
          </button>
        )}
        
        <button
          onClick={toggleFullscreen}
          disabled={!file}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            !file
              ? 'bg-gray-400 cursor-not-allowed text-white'
              : 'bg-purple-500 hover:bg-purple-600 text-white'
          }`}
        >
          {isFullscreen ? '🗗 Exit Fullscreen' : '🗖 Fullscreen'}
        </button>
        
        {ffmpegLoading ? (
          <button 
            disabled 
            className="px-4 py-2 bg-gray-400 text-white rounded-lg font-medium cursor-not-allowed flex items-center gap-2"
          >
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
            Loading FFmpeg...
          </button>
        ) : !ffmpegReady ? (
          <button 
            disabled 
            className="px-4 py-2 bg-red-400 text-white rounded-lg font-medium cursor-not-allowed"
          >
            FFmpeg Failed to Load
          </button>
        ) : isConverting ? (
          <button 
            disabled 
            className="px-4 py-2 bg-yellow-500 text-white rounded-lg font-medium cursor-not-allowed flex items-center gap-2"
          >
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
            Converting to MP4...
          </button>
        ) : !recording ? (
          <button
            onClick={startRecording}
            disabled={!file || !ffmpegReady}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              !file || !ffmpegReady
                ? 'bg-gray-400 cursor-not-allowed text-white'
                : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
          >
            🎥 Record & Download MP4
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <div className="animate-pulse w-2 h-2 bg-white rounded-full"></div>
            Stop Recording
          </button>
        )}
      </div>

      {ffmpegLoading && (
        <div className="mb-4 p-4 bg-blue-100 border border-blue-400 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-600 border-t-transparent"></div>
            <div>
              <p className="text-blue-800 font-medium">Loading FFmpeg...</p>
              <p className="text-blue-600 text-sm">This may take a moment on first load. Please wait.</p>
            </div>
          </div>
        </div>
      )}
      
      {!ffmpegLoading && !ffmpegReady && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 rounded-lg">
          <p className="text-red-800">❌ FFmpeg failed to load. Please refresh the page and try again.</p>
        </div>
      )}
      
      {recording && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 rounded-lg">
          <div className="flex items-center gap-2">
            <div className="animate-pulse w-3 h-3 bg-red-600 rounded-full"></div>
            <p className="text-red-800 font-medium">Recording in progress... Click "Stop Recording" when done.</p>
          </div>
        </div>
      )}
      
      {isConverting && (
        <div className="mb-4 p-4 bg-yellow-100 border border-yellow-400 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-yellow-600 border-t-transparent"></div>
            <div>
              <p className="text-yellow-800 font-medium">Converting WebM to MP4...</p>
              <p className="text-yellow-700 text-sm">This may take a moment depending on video length.</p>
            </div>
          </div>
        </div>
      )}

      <div className="border-2 border-gray-300 rounded-lg p-4 bg-gray-50">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-xl font-semibold">ASCII Output</h2>
          {file && (
            <button
              onClick={toggleFullscreen}
              className="px-3 py-1 bg-purple-500 hover:bg-purple-600 text-white rounded text-sm transition-colors"
            >
              {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
          )}
        </div>
        <video ref={videoRef} src={file || ""} className="hidden" />
        <canvas 
          ref={canvasRef} 
          className={`border border-gray-400 w-full max-w-full h-auto bg-black cursor-pointer ${
            isFullscreen ? 'fixed inset-0 z-50 object-contain' : ''
          }`}
          style={{ backgroundColor: bgColor }}
          onClick={toggleFullscreen}
        />
      </div>
    </div>
  );
}
