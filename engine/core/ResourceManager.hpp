#pragma once

#include <string>
#include <unordered_map>

#include "raylib.h"

// Dueno de texturas/fuentes/sonidos/musica: carga+cachea por ruta y libera
// todo automaticamente (RAII). Tambien es dueno del ciclo de vida del
// dispositivo de audio (raudio), por lo que ningun System de la Capa 2 llama
// InitAudioDevice/CloseAudioDevice directamente.
class ResourceManager {
public:
    ResourceManager();
    ~ResourceManager();

    ResourceManager(const ResourceManager&) = delete;
    ResourceManager& operator=(const ResourceManager&) = delete;

    const Texture2D& GetTexture(const std::string& path);
    const Font& GetFont(const std::string& path);
    const Sound& GetSound(const std::string& path);
    const Music& GetMusic(const std::string& path);

    void UnloadAll();

private:
    std::unordered_map<std::string, Texture2D> textures_;
    std::unordered_map<std::string, Font> fonts_;
    std::unordered_map<std::string, Sound> sounds_;
    std::unordered_map<std::string, Music> music_;
};
