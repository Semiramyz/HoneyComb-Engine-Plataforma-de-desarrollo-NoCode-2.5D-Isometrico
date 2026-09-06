#include "AssetResolver.hpp"

#include <fstream>

AssetResolver::AssetResolver(std::string assetsRoot) : assetsRoot_(std::move(assetsRoot)) {}

std::string AssetResolver::Resolve(const std::string& relativePath) const {
    return assetsRoot_ + "/" + relativePath;
}

bool AssetResolver::Exists(const std::string& relativePath) const {
    std::ifstream file(Resolve(relativePath));
    return file.good();
}
