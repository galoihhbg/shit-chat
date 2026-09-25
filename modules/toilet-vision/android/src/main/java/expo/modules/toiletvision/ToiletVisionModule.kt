package expo.modules.toiletvision

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.objectdetector.ObjectDetector
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.channels.FileChannel

private const val ERR = "ERR_TOILET_VISION"

class VisionException(message: String, cause: Throwable? = null) :
  CodedException(ERR, message, cause)

/**
 * On-device hand landmarks and object detection, via MediaPipe Tasks Vision.
 *
 * Both functions take a local image file and return plain data. The image is
 * never copied, uploaded or retained -- the bitmap is recycled before the
 * function returns, and the caller owns deleting the file.
 */
class ToiletVisionModule : Module() {
  private var handLandmarker: HandLandmarker? = null
  private var handModelPath: String? = null

  private var objectDetector: ObjectDetector? = null
  private var objectModelPath: String? = null

  override fun definition() = ModuleDefinition {
    Name("ToiletVision")

    AsyncFunction("detectHands") { imageUri: String, modelPath: String, maxHands: Int ->
      val bitmap = loadBitmap(imageUri)
      try {
        val result = landmarker(modelPath, maxHands)
          .detect(BitmapImageBuilder(bitmap).build())

        val hands = result.landmarks().mapIndexed { index, points ->
          val category = result.handedness().getOrNull(index)?.firstOrNull()
          mapOf(
            "handedness" to (category?.categoryName() ?: "Unknown"),
            "score" to (category?.score() ?: 0f),
            "landmarks" to points.map {
              mapOf("x" to it.x(), "y" to it.y(), "z" to it.z())
            }
          )
        }
        mapOf("hands" to hands)
      } finally {
        bitmap.recycle()
      }
    }

    AsyncFunction("detectObjects") { imageUri: String, modelPath: String, threshold: Float ->
      val bitmap = loadBitmap(imageUri)
      try {
        val result = detector(modelPath, threshold)
          .detect(BitmapImageBuilder(bitmap).build())

        val objects = result.detections().flatMap { detection ->
          detection.categories().map {
            mapOf("label" to (it.categoryName() ?: ""), "score" to it.score())
          }
        }
        mapOf("objects" to objects)
      } finally {
        bitmap.recycle()
      }
    }

    // Free ~12 MB of models when the proof flow is done with them.
    Function("release") {
      handLandmarker?.close()
      handLandmarker = null
      handModelPath = null
      objectDetector?.close()
      objectDetector = null
      objectModelPath = null
    }

    OnDestroy {
      handLandmarker?.close()
      objectDetector?.close()
    }
  }

  /**
   * Models are memory mapped, not read into the heap, and the task objects
   * are cached so a retry does not reload 12 MB of weights.
   */
  private fun mapModel(modelPath: String): ByteBuffer {
    val file = File(modelPath)
    if (!file.exists()) throw VisionException("Model file missing: $modelPath")
    // Memory mapped, so the weights never land on the Java heap. The mapping
    // outlives the stream, so closing it here is safe.
    return FileInputStream(file).use { stream ->
      stream.channel.map(FileChannel.MapMode.READ_ONLY, 0, file.length())
    }
  }

  private fun landmarker(modelPath: String, maxHands: Int): HandLandmarker {
    handLandmarker?.let { if (handModelPath == modelPath) return it }
    handLandmarker?.close()

    val options = HandLandmarker.HandLandmarkerOptions.builder()
      .setBaseOptions(BaseOptions.builder().setModelAssetBuffer(mapModel(modelPath)).build())
      .setRunningMode(RunningMode.IMAGE)
      .setNumHands(maxHands)
      .setMinHandDetectionConfidence(0.4f)
      .setMinHandPresenceConfidence(0.4f)
      .setMinTrackingConfidence(0.4f)
      .build()

    return try {
      HandLandmarker.createFromOptions(appContext.reactContext!!, options).also {
        handLandmarker = it
        handModelPath = modelPath
      }
    } catch (e: Throwable) {
      throw VisionException("Could not start the hand detector", e)
    }
  }

  private fun detector(modelPath: String, threshold: Float): ObjectDetector {
    objectDetector?.let { if (objectModelPath == modelPath) return it }
    objectDetector?.close()

    val options = ObjectDetector.ObjectDetectorOptions.builder()
      .setBaseOptions(BaseOptions.builder().setModelAssetBuffer(mapModel(modelPath)).build())
      .setRunningMode(RunningMode.IMAGE)
      .setScoreThreshold(threshold)
      .setMaxResults(25)
      .build()

    return try {
      ObjectDetector.createFromOptions(appContext.reactContext!!, options).also {
        objectDetector = it
        objectModelPath = modelPath
      }
    } catch (e: Throwable) {
      throw VisionException("Could not start the object detector", e)
    }
  }

  private fun loadBitmap(imageUri: String): Bitmap {
    val context = appContext.reactContext ?: throw VisionException("No Android context")
    val uri = Uri.parse(imageUri)

    val bitmap = try {
      if (uri.scheme == null || uri.scheme == "file") {
        BitmapFactory.decodeFile(uri.path)
      } else {
        context.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it) }
      }
    } catch (e: Throwable) {
      throw VisionException("Could not read the photo", e)
    } ?: throw VisionException("Could not decode the photo")

    // MediaPipe needs ARGB_8888; hardware bitmaps cannot be read back.
    return if (bitmap.config == Bitmap.Config.ARGB_8888) {
      bitmap
    } else {
      bitmap.copy(Bitmap.Config.ARGB_8888, false).also { bitmap.recycle() }
    }
  }
}
