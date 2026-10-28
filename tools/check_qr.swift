// Проверка QR на картинке тем же распознаванием, что у камеры iPhone (Apple Vision).
// Запуск: swift tools/check_qr.swift poster.png [ещё.png …] — печатает найденные ссылки.
import Foundation
import Vision

for path in CommandLine.arguments.dropFirst() {
    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]
    let handler = VNImageRequestHandler(url: URL(fileURLWithPath: path))
    do {
        try handler.perform([request])
        let found = (request.results ?? []).compactMap { $0.payloadStringValue }.sorted()
        print("\(path): \(found.count)")
        found.forEach { print("  \($0)") }
    } catch {
        print("\(path): error \(error)")
    }
}
