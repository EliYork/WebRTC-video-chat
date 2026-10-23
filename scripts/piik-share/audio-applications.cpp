// Metadata enumeration only. No audio client is activated and no PCM is read.
#define NOMINMAX
#include <windows.h>
#include <tlhelp32.h>
#include <mmdeviceapi.h>
#include <audiopolicy.h>
#include <shellapi.h>
#include <wrl/client.h>
#include <algorithm>
#include <array>
#include <cstdint>
#include <iostream>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace piik::capture {
namespace {
using Microsoft::WRL::ComPtr;
struct App { DWORD pid=0, parent=0; UINT64 created=0; std::wstring path; bool session=false, active=false; };
std::string AudioUtf8(const std::wstring& value) {
  const int size=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,value.data(),static_cast<int>(value.size()),nullptr,0,nullptr,nullptr);
  if(size<=0) return {};
  std::string out(static_cast<size_t>(size),'\0');
  WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,value.data(),static_cast<int>(value.size()),out.data(),size,nullptr,nullptr);
  return out;
}
std::string AudioJson(const std::string& value) {
  constexpr char hex[]="0123456789abcdef";
  std::string out="\"";
  for(unsigned char c:value) {
    if(c=='\\'||c=='"') { out+='\\'; out+=static_cast<char>(c); }
    else if(c<32) { out+="\\u00"; out+=hex[c>>4]; out+=hex[c&15]; }
    else out+=static_cast<char>(c);
  }
  return out+'"';
}
bool AudioProcessIdentity(DWORD pid, App& app) {
  HANDLE process=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,pid);
  if(!process) return false;
  FILETIME created{},exited{},kernel{},user{};
  std::array<wchar_t,32768> path{}; DWORD size=static_cast<DWORD>(path.size());
  const bool ok=WaitForSingleObject(process,0)==WAIT_TIMEOUT && GetProcessTimes(process,&created,&exited,&kernel,&user) && QueryFullProcessImageNameW(process,0,path.data(),&size);
  if(ok) { app.created=(static_cast<UINT64>(created.dwHighDateTime)<<32)|created.dwLowDateTime; app.path.assign(path.data(),size); }
  CloseHandle(process); return ok && app.created!=0;
}
bool AudioInTree(DWORD pid,DWORD root,const std::map<DWORD,App>& apps) {
  for(size_t depth=0;pid!=0 && depth<128;++depth) {
    if(pid==root) return true;
    auto it=apps.find(pid); if(it==apps.end()) return false;
    auto parent=apps.find(it->second.parent);
    if(parent==apps.end() || parent->second.created>it->second.created || parent->first==pid) return false;
    pid=parent->first;
  }
  return false;
}
std::string AudioBase64(const std::vector<BYTE>& bytes) {
  constexpr char chars[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out; out.reserve((bytes.size()+2)/3*4);
  for(size_t i=0;i<bytes.size();i+=3) {
    const UINT32 value=(static_cast<UINT32>(bytes[i])<<16)|(i+1<bytes.size()?static_cast<UINT32>(bytes[i+1])<<8:0)|(i+2<bytes.size()?bytes[i+2]:0);
    out+=chars[(value>>18)&63]; out+=chars[(value>>12)&63]; out+=i+1<bytes.size()?chars[(value>>6)&63]:'='; out+=i+2<bytes.size()?chars[value&63]:'=';
  }
  return out;
}
std::string AudioIcon(const std::wstring& path) {
  SHFILEINFOW info{};
  if(!SHGetFileInfoW(path.c_str(),0,&info,sizeof(info),SHGFI_ICON|SHGFI_SMALLICON) || !info.hIcon) return {};
  constexpr LONG side=24;
  BITMAPINFO bitmap{}; bitmap.bmiHeader.biSize=sizeof(BITMAPINFOHEADER); bitmap.bmiHeader.biWidth=side; bitmap.bmiHeader.biHeight=side;
  bitmap.bmiHeader.biPlanes=1; bitmap.bmiHeader.biBitCount=32; bitmap.bmiHeader.biCompression=BI_RGB;
  void* pixels=nullptr; HDC dc=CreateCompatibleDC(nullptr);
  HBITMAP dib=dc?CreateDIBSection(dc,&bitmap,DIB_RGB_COLORS,&pixels,nullptr,0):nullptr;
  std::string result;
  if(dib && pixels) {
    auto previous=SelectObject(dc,dib);
    memset(pixels,255,static_cast<size_t>(side*side*4));
    if(DrawIconEx(dc,0,0,info.hIcon,side,side,0,nullptr,DI_NORMAL)) {
      BITMAPFILEHEADER header{}; header.bfType=0x4d42; header.bfOffBits=sizeof(header)+sizeof(BITMAPINFOHEADER); header.bfSize=header.bfOffBits+side*side*4;
      std::vector<BYTE> bytes(header.bfSize);
      memcpy(bytes.data(),&header,sizeof(header)); memcpy(bytes.data()+sizeof(header),&bitmap.bmiHeader,sizeof(BITMAPINFOHEADER));
      memcpy(bytes.data()+header.bfOffBits,pixels,side*side*4);
      result="data:image/bmp;base64,"+AudioBase64(bytes);
    }
    SelectObject(dc,previous);
  }
  if(dib) DeleteObject(dib); if(dc) DeleteDC(dc); DestroyIcon(info.hIcon); return result;
}
void AudioSessions(std::map<DWORD,App>& apps) {
  ComPtr<IMMDeviceEnumerator> enumerator;
  if(FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,IID_PPV_ARGS(&enumerator)))) return;
  ComPtr<IMMDeviceCollection> devices;
  if(FAILED(enumerator->EnumAudioEndpoints(eRender,DEVICE_STATE_ACTIVE,&devices))) return;
  UINT count=0; devices->GetCount(&count);
  for(UINT i=0;i<std::min(count,64u);++i) {
    ComPtr<IMMDevice> device; ComPtr<IAudioSessionManager2> manager; ComPtr<IAudioSessionEnumerator> sessions;
    if(FAILED(devices->Item(i,&device)) || FAILED(device->Activate(__uuidof(IAudioSessionManager2),CLSCTX_ALL,nullptr,reinterpret_cast<void**>(manager.GetAddressOf()))) || FAILED(manager->GetSessionEnumerator(&sessions))) continue;
    int length=0; sessions->GetCount(&length);
    for(int j=0;j<std::min(length,1024);++j) {
      ComPtr<IAudioSessionControl> control; ComPtr<IAudioSessionControl2> extended; DWORD pid=0; AudioSessionState state=AudioSessionStateExpired;
      if(FAILED(sessions->GetSession(j,&control)) || FAILED(control.As(&extended)) || FAILED(extended->GetProcessId(&pid)) || pid==0) continue;
      auto app=apps.find(pid); if(app==apps.end()) continue;
      control->GetState(&state); if(state==AudioSessionStateExpired) continue;
      app->second.session=true; app->second.active|=state==AudioSessionStateActive;
    }
  }
}
}
int WriteAudioApplications() {
  const HRESULT com=CoInitializeEx(nullptr,COINIT_MULTITHREADED); if(FAILED(com)) return 2;
  HANDLE snapshot=CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);
  if(snapshot==INVALID_HANDLE_VALUE) { CoUninitialize(); return 2; }
  std::map<DWORD,App> apps; PROCESSENTRY32W entry{}; entry.dwSize=sizeof(entry);
  DWORD ownSession=0; ProcessIdToSessionId(GetCurrentProcessId(),&ownSession);
  if(Process32FirstW(snapshot,&entry)) do {
    DWORD session=0;
    if(!ProcessIdToSessionId(entry.th32ProcessID,&session) || session!=ownSession) continue;
    App app; app.pid=entry.th32ProcessID; app.parent=entry.th32ParentProcessID;
    if(AudioProcessIdentity(app.pid,app)) apps.emplace(app.pid,std::move(app));
  } while(Process32NextW(snapshot,&entry));
  CloseHandle(snapshot);
  AudioSessions(apps);
  // Exclude the trusted Electron parent tree (including our Go/native helpers)
  // and its ancestors. No process command lines or paths cross the wire.
  wchar_t hostText[32]{}; DWORD host=GetCurrentProcessId();
  if(GetEnvironmentVariableW(L"PIIK_SHARE_AUDIO_HOST_PID",hostText,32)>0) {
    wchar_t* end=nullptr; const auto candidate=wcstoul(hostText,&end,10);
    const auto self=apps.find(GetCurrentProcessId());
    if(end && *end==0 && candidate!=0 && self!=apps.end()) {
      const auto parent=apps.find(self->second.parent);
      if(parent!=apps.end() && parent->second.parent==candidate && apps.contains(candidate)) host=candidate;
    }
  }
  std::vector<App> ordered;
  for(const auto& [pid,app]:apps) if(!AudioInTree(pid,host,apps) && !AudioInTree(host,pid,apps)) ordered.push_back(app);
  std::stable_sort(ordered.begin(),ordered.end(),[](const App& a,const App& b) { return a.active!=b.active?a.active>b.active:a.session>b.session; });
  std::cout<<'['; size_t total=2,count=0,iconBudget=96*1024;
  for(const auto& app:ordered) {
    if(count>=1024) break;
    auto name=app.path.substr(app.path.find_last_of(L"\\/")+1);
    auto label=AudioUtf8(name); if(label.empty() || label.size()>512) continue;
    auto icon=iconBudget>4000?AudioIcon(app.path):std::string{}; iconBudget-=std::min(icon.size(),iconBudget);
    const auto row=std::string("{\"pid\":")+std::to_string(app.pid)+",\"creationTime\":\""+std::to_string(app.created)+"\",\"name\":"+AudioJson(label)+",\"hasSession\":"+(app.session?"true":"false")+",\"active\":"+(app.active?"true":"false")+",\"icon\":"+AudioJson(icon)+"}";
    if(total+row.size()+1>510*1024) break;
    if(count++) std::cout<<','; std::cout<<row; total+=row.size()+1;
  }
  std::cout<<']'; CoUninitialize(); return 0;
}
}
