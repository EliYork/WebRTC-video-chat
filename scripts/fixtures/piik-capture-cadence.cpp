// Replays real, anonymized WGC timing through the linked WebRTC controller.
#include "common_video/framerate_controller.h"
#include <cstdint>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <vector>

void Require(bool value, const char* message) {
  if (!value) throw std::runtime_error(message);
}
size_t Count(const std::vector<int64_t>& timestamps, bool legacy = false) {
  webrtc::FramerateController cadence(60);
  int64_t previous = 0, next = 0;
  constexpr int64_t duration = 10'000'000 / 60;
  size_t accepted = 0;
  for (const auto timestamp : timestamps) {
    // Same timestamp validation that precedes the product cadence gate.
    if (timestamp <= 0 || timestamp <= previous) continue;
    if (legacy) {
      if (next && timestamp < next && next - timestamp > duration / 20) continue;
      next = next ? next + ((timestamp > next ? timestamp - next : 0) / duration + 1) * duration
                  : timestamp + duration;
    } else if (cadence.ShouldDropFrame(timestamp * 100)) {
      continue;
    }
    previous = timestamp;
    ++accepted;
  }
  return accepted;
}
int main(int argc, char** argv) {
  try {
    Require(argc == 2, "recorded timestamp file required");
    std::ifstream input(argv[1]);
    std::vector<int64_t> observed;
    int64_t timestamp;
    while (input >> timestamp) observed.push_back(timestamp + 10'000'000);
    Require(observed.size() > 300, "real WGC timing missing");
    const double seconds = (observed.back() - observed.front()) / 1e7;
    const double before = (Count(observed, true) - 1) / seconds;
    const double after = (Count(observed) - 1) / seconds;
    Require(before < 53 && after > 58.5 && after <= 61, "60 FPS jitter regression");
    for (const int hz : {60, 120, 160}) {
      std::vector<int64_t> high;
      for (int i = 0; i < hz * 10; ++i) high.push_back(10'000'000 + int64_t(i) * 10'000'000 / hz);
      const auto count = Count(high);
      Require(count >= 598 && count <= 601, "target FPS cap regression");
    }
    auto dirty = observed;
    for (size_t i = 0; i < observed.size(); ++i) {
      dirty.push_back(observed[i] + 100'000'000);
      dirty.push_back(observed[i] + 100'000'000); // duplicate
      dirty.push_back(observed[i] + 99'999'999);  // backwards
    }
    Require(Count(dirty) == Count(observed) * 2, "pause recovery or monotonic guard regression");
    std::cout << "real WGC replay: legacy=" << before << " FPS, WebRTC=" << after
              << " FPS; 60/120/160 FPS cap, pause and timestamp guards passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
