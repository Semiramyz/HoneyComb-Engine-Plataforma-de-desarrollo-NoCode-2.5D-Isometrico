// Implementacion de ResourceManager. El contrato de la clase esta documentado
// en el .hpp.
//
// Los cuatro Get* siguen el mismo patron "buscar o cargar": si la ruta ya esta
// en la cache se devuelve lo que hay; si no, se carga una vez y se guarda. Por
// eso dos entidades que usan la misma textura no la suben dos veces a la GPU.
//
// Todos devuelven una REFERENCIA a lo que vive en el mapa, no una copia: quien
// llama no es dueno del recurso y no debe liberarlo. De eso se encarga
// UnloadAll() desde el destructor.

#include "ResourceManager.hpp"

// El dispositivo de audio se abre junto con el manager y se cierra con el, para
// que ningun System tenga que acordarse de hacerlo.
ResourceManager::ResourceManager() {
    InitAudioDevice();
}

// El orden es obligatorio: primero se sueltan los recursos y recien despues se
// cierra el dispositivo de audio. Al reves, liberar un Sound sobre un
// dispositivo ya cerrado es comportamiento indefinido.
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

// Libera todo lo cacheado y vacia los mapas. Lo llama el destructor, pero es
// publico para poder descargar el nivel anterior al cambiar de nivel. Ojo:
// despues de esto, cualquier referencia devuelta por un Get* queda colgada.
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
