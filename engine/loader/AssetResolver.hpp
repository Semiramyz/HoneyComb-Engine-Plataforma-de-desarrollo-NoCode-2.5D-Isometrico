#pragma once

#include <string>

// Resuelve rutas de assets tal como aparecen en el JSON del nivel (relativas
// a la carpeta assets/ del proyecto) a una ruta real en disco. Centraliza la
// convencion de rutas para que el editor y el runtime coincidan siempre.
class AssetResolver {
public:
    explicit AssetResolver(std::string assetsRoot = "assets");

    std::string Resolve(const std::string& relativePath) const;
    bool Exists(const std::string& relativePath) const;

private:
    std::string assetsRoot_;
};
