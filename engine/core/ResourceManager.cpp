#include "ResourceManager.hpp"

ResourceManager::ResourceManager() {
    InitAudioDevice();
}

ResourceManager::~ResourceManager() {
    UnloadAll();
    CloseAudioDevice();
}

const Texture2D& ResourceManager::GetTexture(const std::string& path) {
    auto it = textures_.find(path);
    if (it != textures_.end()) {
        return it->second;
    }

    Texture2D texture = LoadTexture(path.c_str());
    // Pixel art: sin esto, raylib interpola (bilinear) al escalar la textura
    // y el arte se ve borroso en vez de nitido.
    SetTextureFilter(texture, TEXTURE_FILTER_POINT);

    return textures_.emplace(path, texture).first->second;
}

const Font& ResourceManager::GetFont(const std::string& path) {
    auto it = fonts_.find(path);
    if (it != fonts_.end()) {
        return it->second;
    }

    Font font = LoadFont(path.c_str());
    SetTextureFilter(font.texture, TEXTURE_FILTER_POINT);

    return fonts_.emplace(path, font).first->second;
}

const Sound& ResourceManager::GetSound(const std::string& path) {
    auto it = sounds_.find(path);
    if (it != sounds_.end()) {
        return it->second;
    }

    Sound sound = LoadSound(path.c_str());
    return sounds_.emplace(path, sound).first->second;
}

const Music& ResourceManager::GetMusic(const std::string& path) {
    auto it = music_.find(path);
    if (it != music_.end()) {
        return it->second;
    }

    Music music = LoadMusicStream(path.c_str());
    return music_.emplace(path, music).first->second;
}

void ResourceManager::UnloadAll() {
    for (auto& [path, texture] : textures_) {
        UnloadTexture(texture);
    }
    textures_.clear();

    for (auto& [path, font] : fonts_) {
        UnloadFont(font);
    }
    fonts_.clear();

    for (auto& [path, sound] : sounds_) {
        UnloadSound(sound);
    }
    sounds_.clear();

    for (auto& [path, music] : music_) {
        UnloadMusicStream(music);
    }
    music_.clear();
}
