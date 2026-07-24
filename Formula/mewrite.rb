class Mewrite < Formula
  desc "Me Write Code terminal coding agent"
  homepage "https://github.com/Zhachory1/mewritecode"
  version "1.2.1"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-darwin-arm64.tar.gz"
      sha256 "8a188f623cc050a91cd6bb1e91f73a09a860b399743311e083f812437ae7f20e"
    end
    on_intel do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-darwin-x64.tar.gz"
      sha256 "5b312232d4062cfaf0658f970f382d395ef6a61268684314cf637ca352a4b8af"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-linux-arm64.tar.gz"
      sha256 "adf7c628fef7a0ce1c37746ddf00dac9f4daec832efcfc7477f2119dcceab88a"
    end
    on_intel do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-linux-x64.tar.gz"
      sha256 "3f6a221fc1f58fa2d0794c7a3163a75ee95d2a644a59f21554a8a8399800a04d"
    end
  end

  def install
    # mewrite resolves theme/, export-html/, photon_rs_bg.wasm, etc. relative to
    # dirname(process.execPath), so the binary and companions must live together.
    libexec.install Dir["*"]
    bin.write_exec_script libexec/"mewrite"
    bin.install_symlink bin/"mewrite" => "mewrite-code"
    bin.install_symlink bin/"mewrite" => "mewritecode"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/mewrite --version")
  end
end
