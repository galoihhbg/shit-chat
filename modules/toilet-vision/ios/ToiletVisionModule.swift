import ExpoModulesCore
import MediaPipeTasksVision
import UIKit

/**
 * On-device hand landmarks and object detection, via MediaPipe Tasks Vision.
 *
 * Mirrors the Android module. The image is read, analysed and released; it is
 * never copied elsewhere or uploaded. The caller owns deleting the file.
 */
public class ToiletVisionModule: Module {
  private var handLandmarker: HandLandmarker?
  private var handModelPath: String?

  private var objectDetector: ObjectDetector?
  private var objectModelPath: String?

  public func definition() -> ModuleDefinition {
    Name("ToiletVision")

    AsyncFunction("detectHands") { (imageUri: String, modelPath: String, maxHands: Int) -> [String: Any] in
      let image = try self.loadImage(imageUri)
      let landmarker = try self.landmarker(modelPath: modelPath, maxHands: maxHands)
      let mpImage = try MPImage(uiImage: image)
      let result = try landmarker.detect(image: mpImage)

      let hands: [[String: Any]] = result.landmarks.enumerated().map { index, points in
        let category = index < result.handedness.count ? result.handedness[index].first : nil
        return [
          "handedness": category?.categoryName ?? "Unknown",
          "score": category?.score ?? 0,
          "landmarks": points.map { ["x": $0.x, "y": $0.y, "z": $0.z] },
        ]
      }
      return ["hands": hands]
    }

    AsyncFunction("detectObjects") { (imageUri: String, modelPath: String, threshold: Double) -> [String: Any] in
      let image = try self.loadImage(imageUri)
      let detector = try self.detector(modelPath: modelPath, threshold: Float(threshold))
      let mpImage = try MPImage(uiImage: image)
      let result = try detector.detect(image: mpImage)

      let objects: [[String: Any]] = result.detections.flatMap { detection in
        detection.categories.map { ["label": $0.categoryName ?? "", "score": $0.score] }
      }
      return ["objects": objects]
    }

    Function("release") {
      self.handLandmarker = nil
      self.handModelPath = nil
      self.objectDetector = nil
      self.objectModelPath = nil
    }
  }

  private func landmarker(modelPath: String, maxHands: Int) throws -> HandLandmarker {
    if let existing = handLandmarker, handModelPath == modelPath {
      return existing
    }
    guard FileManager.default.fileExists(atPath: modelPath) else {
      throw Exception(name: "ERR_TOILET_VISION", description: "Model file missing: \(modelPath)")
    }

    let options = HandLandmarkerOptions()
    options.baseOptions.modelAssetPath = modelPath
    options.runningMode = .image
    options.numHands = maxHands
    options.minHandDetectionConfidence = 0.4
    options.minHandPresenceConfidence = 0.4
    options.minTrackingConfidence = 0.4

    let created = try HandLandmarker(options: options)
    handLandmarker = created
    handModelPath = modelPath
    return created
  }

  private func detector(modelPath: String, threshold: Float) throws -> ObjectDetector {
    if let existing = objectDetector, objectModelPath == modelPath {
      return existing
    }
    guard FileManager.default.fileExists(atPath: modelPath) else {
      throw Exception(name: "ERR_TOILET_VISION", description: "Model file missing: \(modelPath)")
    }

    let options = ObjectDetectorOptions()
    options.baseOptions.modelAssetPath = modelPath
    options.runningMode = .image
    options.scoreThreshold = threshold
    options.maxResults = 25

    let created = try ObjectDetector(options: options)
    objectDetector = created
    objectModelPath = modelPath
    return created
  }

  private func loadImage(_ imageUri: String) throws -> UIImage {
    let path: String
    if let url = URL(string: imageUri), url.isFileURL {
      path = url.path
    } else {
      path = imageUri
    }
    guard let image = UIImage(contentsOfFile: path) else {
      throw Exception(name: "ERR_TOILET_VISION", description: "Could not read the photo")
    }
    return image
  }
}
