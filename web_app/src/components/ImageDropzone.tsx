import { useState } from "react"
import useResolution from "@/hooks/useResolution"
import { cn } from "@/lib/utils"

type ImageDropzoneProps = {
  onSelection: (file: File) => void
  fullscreen?: boolean
  floating?: boolean
  className?: string
}

export default function ImageDropzone(props: ImageDropzoneProps) {
  const { onSelection, fullscreen = false, floating = false, className } = props
  const [uploadElemId] = useState(`file-upload-${Math.random().toString()}`)
  const resolution = useResolution()
  const isFloating = fullscreen || floating

  function onFileSelected(file: File) {
    if (!file) {
      return
    }

    const isImage = file.type.match("image.*")
    if (!isImage) {
      return
    }

    try {
      if (file.size > 20 * 1024 * 1024) {
        throw new Error("file too large")
      }
      onSelection(file)
    } catch (e) {
      alert(`error: ${(e as any).message}`)
    }
  }

  return (
    <div
      className={cn(
        fullscreen
          ? "absolute flex w-screen h-screen justify-center items-center pointer-events-none"
          : floating
            ? "absolute inset-0 flex items-center justify-center pointer-events-none"
            : "w-full",
        className
      )}
    >
      <label
        htmlFor={uploadElemId}
        className={cn(
          "grid bg-background border-[2px] border-[dashed] rounded-lg transition-colors hover:bg-primary hover:text-primary-foreground",
          isFloating
            ? "w-[min(600px,calc(100%-3rem))] min-h-[280px] cursor-pointer pointer-events-auto"
            : "w-full min-h-[280px] cursor-pointer"
        )}
      >
        <div
          className="grid p-16 w-full h-full place-items-center"
          onDragOver={(ev) => {
            ev.stopPropagation()
            ev.preventDefault()
          }}
        >
          <input
            className="hidden"
            id={uploadElemId}
            name={uploadElemId}
            type="file"
            onChange={(ev) => {
              const file = ev.currentTarget.files?.[0]
              if (file) {
                onFileSelected(file)
              }
            }}
            accept="image/png, image/jpeg"
          />
          <p className="text-center">
            {resolution === "desktop"
              ? "点击此处或拖入图片文件"
              : "点击此处加载图片"}
          </p>
        </div>
      </label>
    </div>
  )
}
