// Synthetic GPU textures -> Piik's real MF H.264 + WebRTC adaptation pipeline.
// No WGC, window, desktop, microphone, or visible UI is accessed.
#include "adaptive_encoder.h"
#include "capture_output.h"
#include <algorithm>
#include <array>
#include <fstream>
#include <iostream>
#include <numeric>
#include <map>
#include <thread>

using namespace piik::capture;
using namespace piik::capture::windows;

struct Output {
  VideoProfile profile;
  std::array<ComPtr<ID3D11Texture2D>, 8> textures;
  std::map<std::pair<UINT32,UINT32>,std::array<ComPtr<ID3D11Texture2D>,8>> scaled;
  std::unique_ptr<AdaptiveEncoder> encoder;
  unsigned frames=0, dropped=0;
  unsigned reduced=0;
  uint64_t bytes=0;
  std::vector<double> work;
};

ComPtr<ID3D11Texture2D> Texture(ID3D11Device* device, VideoProfile p, unsigned frame) {
  std::vector<uint8_t> pixels(static_cast<size_t>(p.width)*p.height*3/2, 128);
  for (unsigned y=0; y<p.height; y++) for (unsigned x=0; x<p.width; x++) {
    const unsigned u=(x*1920/p.width+frame*23)%128, v=(y*1080/p.height+frame*7)%128;
    pixels[static_cast<size_t>(y)*p.width+x]=static_cast<uint8_t>(32+((u/8)^(v/8))*8+((u^v)&31)*2);
  }
  D3D11_TEXTURE2D_DESC d{};
  d.Width=p.width; d.Height=p.height; d.Format=DXGI_FORMAT_NV12;
  d.MipLevels=1; d.ArraySize=1; d.SampleDesc.Count=1;
  d.Usage=D3D11_USAGE_DEFAULT; d.BindFlags=D3D11_BIND_RENDER_TARGET;
  D3D11_SUBRESOURCE_DATA init{}; init.pSysMem=pixels.data(); init.SysMemPitch=p.width;
  ComPtr<ID3D11Texture2D> texture;
  Check(device->CreateTexture2D(&d,&init,&texture),"synthetic-texture");
  return texture;
}

double CpuMs() {
  FILETIME a{},b{},k{},u{};
  if (!GetProcessTimes(GetCurrentProcess(),&a,&b,&k,&u)) throw std::runtime_error("CPU unavailable");
  auto ticks=[](FILETIME t){return (uint64_t(t.dwHighDateTime)<<32)|t.dwLowDateTime;};
  return double(ticks(k)+ticks(u))/10000;
}

int main(int argc,char** argv) {
  try {
    if (argc!=7) throw std::runtime_error("width height bitrate seconds extra-output capture-file");
    Runtime runtime;
    const VideoProfile profile{static_cast<UINT32>(std::stoul(argv[1])),static_cast<UINT32>(std::stoul(argv[2])),60,static_cast<UINT32>(std::stoul(argv[3])),DegradationPreference::framerate};
    const unsigned seconds=std::stoul(argv[4]);
    if(seconds<2||seconds>30||profile.width>3840||profile.height>2160) throw std::runtime_error("bounded fixture only");
    const auto adapters=EnumerateAdapters();
    const auto selected=std::find_if(adapters.begin(),adapters.end(),[](const auto& a){return a.description.VendorId==0x10de;});
    if(selected==adapters.end()) throw std::runtime_error("NVIDIA adapter unavailable");
    auto device=CreateDevice(*selected);
    std::vector<Output> outputs(std::stoi(argv[5])?2:1);
    std::string encoder_name;
    for(size_t i=0;i<outputs.size();i++) {
      auto& o=outputs[i]; o.profile=i==0?profile:VideoProfile{profile.width/2,profile.height/2,60,profile.bit_rate/4,DegradationPreference::framerate};
      for(unsigned j=0;j<o.textures.size();j++)o.textures[j]=Texture(device.device.Get(),o.profile,j);
      const auto create=[&device,&selected](const VideoProfile& p){
        auto encoders=EnumerateHardwareEncoders(*selected);
        return std::make_unique<LiveEncoder>(ActivateTransform(encoders,0,device.manager.Get()),p);
      };
      auto initial=create(o.profile);encoder_name=initial->name;
      o.encoder=std::make_unique<AdaptiveEncoder>(OutputKind::h264,o.profile,device.device.Get(),create,std::move(initial),static_cast<int>(i));
    }
    std::ofstream recording;
    if(std::string(argv[6])!="-")recording.open(argv[6],std::ios::binary);
    const auto interval=std::chrono::nanoseconds(1000000000/60);
    auto start=EncoderClock::now();
    double cpu=0;unsigned missed=0;
    const unsigned warm=60;
    for(unsigned f=0; f<warm+seconds*60; f++) {
      if(f==warm){start=EncoderClock::now()-interval*warm;cpu=CpuMs();}
      const auto due=start+interval*f;
      std::this_thread::sleep_until(due);
      if(EncoderClock::now()>due+interval*2 && f>=warm){missed++;continue;}
      for(size_t i=0;i<outputs.size();i++) {
        auto& o=outputs[i];
        const auto began=EncoderClock::now();
        auto encoded=o.encoder->Encode([&](UINT32 w,UINT32 h){
          if(w!=o.profile.width||h!=o.profile.height){
            auto& set=o.scaled[{w,h}];
            if(!set[0]){auto p=o.profile;p.width=w;p.height=h;for(unsigned j=0;j<8;j++)set[j]=Texture(device.device.Get(),p,j);}
            return set[f%8];
          }
          return o.textures[f%o.textures.size()];
        },o.profile.width,o.profile.height,(uint64_t(f)+1)*10000000/60,f%120==0,o.profile.bit_rate,began+std::chrono::seconds(2));
        if(f<warm)continue;
        o.work.push_back(std::chrono::duration<double,std::milli>(EncoderClock::now()-began).count());
        if(!encoded){o.dropped++;continue;}
        if(encoded->width!=o.profile.width||encoded->height!=o.profile.height)o.reduced++;
        o.frames++;o.bytes+=encoded->access_unit.bytes.size();
        if(recording.is_open()&&i==0) {
          // Local synthetic frames only. Length and key flag followed by Annex B.
          const uint32_t length=static_cast<uint32_t>(encoded->access_unit.bytes.size());
          const uint8_t key=encoded->access_unit.key_frame;
          recording.write(reinterpret_cast<const char*>(&length),4);recording.write(reinterpret_cast<const char*>(&key),1);
          recording.write(reinterpret_cast<const char*>(encoded->access_unit.bytes.data()),length);
        }
      }
    }
    const double elapsed=std::chrono::duration<double>(EncoderClock::now()-(start+interval*warm)).count();
    std::cout<<"{\"width\":"<<profile.width<<",\"height\":"<<profile.height<<",\"targetFps\":60,\"targetBitrate\":"<<profile.bit_rate
      <<",\"seconds\":"<<elapsed<<",\"cpuMs\":"<<CpuMs()-cpu<<",\"scheduleMissed\":"<<missed
      <<",\"adapter\":"<<std::quoted(NarrowAscii(selected->description.Description))<<",\"encoder\":"<<std::quoted(encoder_name)<<",\"outputs\":[";
    for(size_t i=0;i<outputs.size();i++) {
      auto& o=outputs[i];std::sort(o.work.begin(),o.work.end());
      std::cout<<(i?",":"")<<"{\"width\":"<<o.profile.width<<",\"height\":"<<o.profile.height
        <<",\"frames\":"<<o.frames<<",\"reducedResolutionFrames\":"<<o.reduced<<",\"noOutput\":"<<o.dropped<<",\"fps\":"<<o.frames/elapsed
        <<",\"mbps\":"<<double(o.bytes)*8/elapsed/1e6<<",\"meanWorkMs\":"<<std::accumulate(o.work.begin(),o.work.end(),0.0)/o.work.size()
        <<",\"p95WorkMs\":"<<o.work[o.work.size()*95/100]<<"}";
    }
    std::cout<<"]}\n";
    return 0;
  }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
