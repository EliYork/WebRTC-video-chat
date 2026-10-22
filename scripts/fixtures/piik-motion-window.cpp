// Test content only. Piik owns all WGC capture and encoding.
// A private, silent D3D window; never captures or injects input into other apps.
#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <d3dcompiler.h>
#include <wrl/client.h>
#include <chrono>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <cstring>
using Microsoft::WRL::ComPtr;
void Check(HRESULT hr) { if (FAILED(hr)) throw std::runtime_error("D3D motion window failure"); }
LRESULT CALLBACK WindowProc(HWND w,UINT m,WPARAM p,LPARAM l) {
  if(m==WM_CLOSE){DestroyWindow(w);return 0;}
  if(m==WM_DESTROY){PostQuitMessage(0);return 0;}
  return DefWindowProcW(w,m,p,l);
}
int main(int argc,char** argv) {
  try {
    if(argc!=4) throw std::runtime_error("width height seconds");
    const unsigned width=std::stoul(argv[1]),height=std::stoul(argv[2]),seconds=std::stoul(argv[3]);
    if(width<640||height<360||width>3840||height>2160||seconds<5||seconds>120) throw std::runtime_error("bounded test window only");
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    const auto instance=GetModuleHandleW(nullptr);
    WNDCLASSW wc{};wc.lpfnWndProc=WindowProc;wc.hInstance=instance;wc.lpszClassName=L"PiikIsolatedMotion";
    if(!RegisterClassW(&wc))throw std::runtime_error("window class");
    HWND window=CreateWindowExW(WS_EX_NOACTIVATE,wc.lpszClassName,L"Piik isolated motion test",WS_POPUP,
        20,20,width,height,nullptr,nullptr,instance,nullptr);
    if(!window)throw std::runtime_error("window creation");
    ComPtr<IDXGIFactory1> factory;Check(CreateDXGIFactory1(IID_PPV_ARGS(&factory)));
    ComPtr<IDXGIAdapter1> adapter;
    for(UINT i=0;;++i){ComPtr<IDXGIAdapter1> a;if(factory->EnumAdapters1(i,&a)==DXGI_ERROR_NOT_FOUND)break;
      DXGI_ADAPTER_DESC1 d{};Check(a->GetDesc1(&d));if(d.VendorId==0x10de){adapter=a;break;}}
    if(!adapter)throw std::runtime_error("NVIDIA adapter unavailable");
    DXGI_SWAP_CHAIN_DESC sd{};sd.BufferDesc.Width=width;sd.BufferDesc.Height=height;
    sd.BufferDesc.Format=DXGI_FORMAT_B8G8R8A8_UNORM;sd.SampleDesc.Count=1;sd.BufferUsage=DXGI_USAGE_RENDER_TARGET_OUTPUT;
    sd.BufferCount=2;sd.OutputWindow=window;sd.Windowed=TRUE;sd.SwapEffect=DXGI_SWAP_EFFECT_FLIP_DISCARD;
    ComPtr<ID3D11Device> device;ComPtr<ID3D11DeviceContext> context;ComPtr<IDXGISwapChain> swap;
    Check(D3D11CreateDeviceAndSwapChain(adapter.Get(),D3D_DRIVER_TYPE_UNKNOWN,nullptr,0,nullptr,0,D3D11_SDK_VERSION,&sd,&swap,&device,nullptr,&context));
    ComPtr<ID3D11Texture2D> back;Check(swap->GetBuffer(0,IID_PPV_ARGS(&back)));
    ComPtr<ID3D11RenderTargetView> target;Check(device->CreateRenderTargetView(back.Get(),nullptr,&target));
    const char shader[]=R"(
      cbuffer Params:register(b0){float frame;float width;float height;float unused;};
      float4 VS(uint id:SV_VertexID):SV_POSITION{return float4(id==1?3:-1,id==2?3:-1,0,1);}
      float4 PS(float4 p:SV_POSITION):SV_TARGET{
        float2 uv=p.xy/float2(width,height);
        float grid=fmod(floor((p.x+frame*5)/80)+floor((p.y+frame*2)/80),2);
        float bar=abs(uv.x-frac(frame/180))<0.035;
        float3 c=lerp(float3(.16,.22,.30),float3(.22,.30,.40),grid);
        c=lerp(c,float3(.95,.40,.65),bar);return float4(c,1);
      })";
    ComPtr<ID3DBlob> vs,ps,error;
    Check(D3DCompile(shader,sizeof(shader),nullptr,nullptr,nullptr,"VS","vs_5_0",D3DCOMPILE_OPTIMIZATION_LEVEL3,0,&vs,&error));
    Check(D3DCompile(shader,sizeof(shader),nullptr,nullptr,nullptr,"PS","ps_5_0",D3DCOMPILE_OPTIMIZATION_LEVEL3,0,&ps,&error));
    ComPtr<ID3D11VertexShader> vertex;ComPtr<ID3D11PixelShader> pixel;
    Check(device->CreateVertexShader(vs->GetBufferPointer(),vs->GetBufferSize(),nullptr,&vertex));
    Check(device->CreatePixelShader(ps->GetBufferPointer(),ps->GetBufferSize(),nullptr,&pixel));
    D3D11_BUFFER_DESC bd{};bd.ByteWidth=16;bd.Usage=D3D11_USAGE_DYNAMIC;bd.BindFlags=D3D11_BIND_CONSTANT_BUFFER;bd.CPUAccessFlags=D3D11_CPU_ACCESS_WRITE;
    ComPtr<ID3D11Buffer> params;Check(device->CreateBuffer(&bd,nullptr,&params));
    context->OMSetRenderTargets(1,target.GetAddressOf(),nullptr);
    D3D11_VIEWPORT vp{0,0,float(width),float(height),0,1};context->RSSetViewports(1,&vp);
    context->VSSetShader(vertex.Get(),nullptr,0);context->PSSetShader(pixel.Get(),nullptr,0);
    context->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    context->PSSetConstantBuffers(0,1,params.GetAddressOf());
    D3D11_RASTERIZER_DESC rd{};rd.FillMode=D3D11_FILL_SOLID;rd.CullMode=D3D11_CULL_NONE;rd.DepthClipEnable=TRUE;
    ComPtr<ID3D11RasterizerState> raster;Check(device->CreateRasterizerState(&rd,&raster));context->RSSetState(raster.Get());
    ShowWindow(window,SW_SHOWNOACTIVATE);
    FILETIME creation{},exit{},kernel{},user{};GetProcessTimes(GetCurrentProcess(),&creation,&exit,&kernel,&user);
    const auto created=(uint64_t(creation.dwHighDateTime)<<32)|creation.dwLowDateTime;
    std::cout<<"{\"hwnd\":\""<<uint64_t(reinterpret_cast<UINT_PTR>(window))<<"\",\"pid\":"<<GetCurrentProcessId()<<",\"creationTime\":\""<<created<<"\",\"width\":"<<width<<",\"height\":"<<height<<"}"<<std::endl;
    const auto start=std::chrono::steady_clock::now();unsigned frames=0,late=0;
    for(unsigned f=0;f<seconds*60;++f){
      MSG msg{};while(PeekMessageW(&msg,nullptr,0,0,PM_REMOVE)){if(msg.message==WM_QUIT)return 0;TranslateMessage(&msg);DispatchMessageW(&msg);}
      const auto due=start+std::chrono::nanoseconds(uint64_t(f)*1000000000/60);
      std::this_thread::sleep_until(due);
      if(std::chrono::steady_clock::now()>due+std::chrono::milliseconds(17))late++;
      float values[]{float(f),float(width),float(height),0};D3D11_MAPPED_SUBRESOURCE mapped{};
      Check(context->Map(params.Get(),0,D3D11_MAP_WRITE_DISCARD,0,&mapped));std::memcpy(mapped.pData,values,sizeof(values));context->Unmap(params.Get(),0);
      // Flip-model Present unbinds the back buffer; bind again for every frame.
      context->OMSetRenderTargets(1,target.GetAddressOf(),nullptr);
      context->Draw(3,0);Check(swap->Present(0,0));frames++;
      if(frames%60==0){const double t=std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count();
        std::cout<<"{\"rendered\":"<<frames<<",\"elapsed\":"<<t<<",\"fps\":"<<frames/t<<",\"late\":"<<late<<"}"<<std::endl;}
    }
    const double elapsed=std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count();
    std::cout<<"{\"rendered\":"<<frames<<",\"elapsed\":"<<elapsed<<",\"fps\":"<<frames/elapsed<<",\"late\":"<<late<<"}"<<std::endl;
    DestroyWindow(window);return 0;
  }catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}
}
